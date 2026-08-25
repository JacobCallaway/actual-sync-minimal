import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import chalk from "chalk";
import { AppConfig } from "./config";
import { renderDashboardApp } from "./dashboard";
import {
  ReconcileReport,
  completeConnection,
  refreshAllAccounts,
  removeConnection,
} from "./connections";
import {
  Mapping,
  daysUntilExpiry,
  deriveStatus,
  loadState,
  updateState,
} from "./state";
import { buildAuthUrl, extractAuthCode } from "./truelayer";

// Interface for Job Info
interface JobInfo {
  status: "pending" | "running" | "success" | "failed";
  logs: string;
}

// In-memory jobs store for local mode
const localJobs = new Map<string, JobInfo>();

// In-memory cache for K8s jobs
const k8sJobLogsCache = new Map<string, JobInfo>();

/** Path the server answers the TrueLayer redirect on. */
const CALLBACK_PATH = "/api/truelayer/callback";

/** An authorization run started in the browser and not yet completed. Lives
 * only in memory — a restart mid-consent just means starting over. */
type PendingAuth = {
  id: string;
  connectionId?: string;
  createdAt: number;
  status: "waiting" | "done" | "error";
  report?: ReconcileReport;
  error?: string;
};
const pendingAuths = new Map<string, PendingAuth>();
const PENDING_TTL_MS = 15 * 60 * 1000;

const prunePending = () => {
  for (const [id, p] of pendingAuths) {
    if (Date.now() - p.createdAt > PENDING_TTL_MS) pendingAuths.delete(id);
  }
};

// Kubernetes config helper
const getK8sConfig = () => {
  const tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token";
  const caPath = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
  const namespacePath = "/var/run/secrets/kubernetes.io/serviceaccount/namespace";

  if (!fs.existsSync(tokenPath)) {
    return null;
  }

  try {
    return {
      token: fs.readFileSync(tokenPath, "utf8").trim(),
      ca: fs.readFileSync(caPath),
      namespace: fs.readFileSync(namespacePath, "utf8").trim(),
      host: "kubernetes.default.svc",
    };
  } catch (err) {
    console.error("Failed to read K8s service account credentials:", err);
    return null;
  }
};

// Kubernetes API request helper using built-in https module
const k8sRequest = (
  config: any,
  method: string,
  urlPath: string,
  body?: any
): Promise<any> => {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: config.host,
      port: 443,
      path: urlPath,
      method: method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      ca: config.ca,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`K8s API responded with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

const readJsonBody = (req: http.IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      // Nothing this API accepts is large; refuse to buffer more.
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("error", reject);
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body is not valid JSON"));
      }
    });
  });

export const startServer = (config: AppConfig, port: number = 8080) => {
  const k8s = getK8sConfig();
  const isK8s = k8s !== null;
  const cronjobName = process.env.ACTUAL_SYNC_CRONJOB_NAME || "actual-bank-sync";
  const dashboardDir = process.env.DASHBOARD_DATA_DIR || "/app/data";
  const authToken = process.env.DASHBOARD_TOKEN;

  // The server can complete the OAuth redirect itself only when the configured
  // redirect URI actually points back at this callback. Otherwise the browser
  // falls back to pasting the code, which works with TrueLayer's own redirect page.
  const usesServerCallback = (() => {
    try {
      return new URL(config.truelayer.redirectUri).pathname.endsWith(
        CALLBACK_PATH,
      );
    } catch {
      return false;
    }
  })();

  console.log(
    chalk.cyan(
      `Booting actual-sync dashboard backend (Mode: ${isK8s ? "Kubernetes" : "Local"}, Port: ${port})`
    )
  );
  console.log(
    chalk.gray(
      `Bank authorisation flow: ${usesServerCallback ? "server callback" : "paste the code"}`,
    ),
  );
  if (!authToken) {
    console.log(
      chalk.yellow(
        "No DASHBOARD_TOKEN set — the dashboard is unauthenticated. Set one before exposing it beyond localhost.",
      ),
    );
  }

  const server = http.createServer(async (req, res) => {
    // This API mutates state and sits next to bank credentials, so it is
    // same-origin only rather than open to any site the browser visits.
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || "/";
    const parsedUrl = new URL(url, `http://${req.headers.host || "localhost"}`);
    let pathname = parsedUrl.pathname;

    // Strip Traefik subpath prefix if present
    if (pathname.startsWith("/actual-sync-minimal")) {
      pathname = pathname.substring("/actual-sync-minimal".length);
    }
    if (pathname === "") {
      pathname = "/";
    }

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const fail = (status: number, message: string) => json(status, { error: message });

    // The callback arrives straight from the bank's redirect, so it carries no
    // header we control and is authenticated by its unguessable state value.
    if (authToken && pathname !== CALLBACK_PATH) {
      const provided =
        req.headers.authorization?.replace(/^Bearer\s+/i, "") ??
        parsedUrl.searchParams.get("token") ??
        "";
      if (provided !== authToken) {
        return fail(401, "Unauthorized — a valid dashboard token is required.");
      }
    }

    // --- Serve the app ---
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderDashboardApp());
      return;
    }

    if (pathname === "/sync-summary.json") {
      const filePath = path.join(dashboardDir, "sync-summary.json");
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fs.readFileSync(filePath));
      } else {
        return fail(404, "Sync summary not found");
      }
      return;
    }

    // --- Configuration & mapping API ---
    if (pathname === "/api/state" && req.method === "GET") {
      try {
        const state = loadState(config);
        return json(200, {
          flow: usesServerCallback ? "callback" : "paste",
          connections: state.connections.map((c) => ({
            id: c.id,
            label: c.label,
            status: deriveStatus(c),
            daysUntilExpiry: daysUntilExpiry(c),
            connectedAt: c.connectedAt,
            lastRefreshAt: c.lastRefreshAt ?? null,
            lastRefreshError: c.lastRefreshError ?? null,
            accountCount: c.accounts.length,
            accounts: c.accounts.map((a) => ({
              id: a.id,
              name: a.name,
              type: a.type,
            })),
          })),
          mappings: state.map,
          actualAccounts: state.actualAccountsCache?.accounts ?? [],
          actualAccountsFetchedAt: state.actualAccountsCache?.fetchedAt ?? null,
        });
      } catch (err: any) {
        return fail(500, err.message);
      }
    }

    if (pathname === "/api/mappings" && req.method === "PUT") {
      try {
        const body = await readJsonBody(req);
        const incoming: Mapping[] = Array.isArray(body?.mappings)
          ? body.mappings
          : [];

        const state = loadState(config);
        const known = new Set(state.connections.map((c) => c.id));
        const cleaned: Mapping[] = [];
        for (const m of incoming) {
          if (!m?.name || !m?.truelayerAccountId || !m?.actualAccountId) {
            return fail(
              400,
              "Every mapping needs a name, a bank account and an Actual account.",
            );
          }
          if (!known.has(m.connectionId)) {
            return fail(
              400,
              `Mapping "${m.name}" refers to a bank connection that no longer exists.`,
            );
          }
          cleaned.push({
            id: m.id || randomUUID(),
            name: String(m.name).trim(),
            connectionId: m.connectionId,
            truelayerAccountId: m.truelayerAccountId,
            actualAccountId: m.actualAccountId,
            mapConfig: { invertAmount: Boolean(m.mapConfig?.invertAmount) },
            enabled: m.enabled !== false,
          });
        }

        await updateState(config, (fresh) => {
          fresh.map = cleaned;
        });
        return json(200, { ok: true, count: cleaned.length });
      } catch (err: any) {
        return fail(400, err.message);
      }
    }

    if (pathname.startsWith("/api/connections/") && req.method === "DELETE") {
      const id = decodeURIComponent(pathname.substring("/api/connections/".length));
      try {
        const result = await removeConnection(config, id);
        return json(200, { ok: true, ...result });
      } catch (err: any) {
        return fail(500, err.message);
      }
    }

    if (pathname === "/api/accounts/refresh" && req.method === "POST") {
      try {
        const reports = await refreshAllAccounts(config);

        // Refreshing the Actual side needs a full budget download, so it is
        // done here on demand rather than on every dashboard load.
        let actualAccounts: { id: string; name: string }[] = [];
        try {
          const { alignApiDependency } = await import("./align");
          await alignApiDependency(config);
          const { openActualSession } = await import("./actual");
          const state = loadState(config);
          const session = await openActualSession(config.actual, {
            ...(state.actualCacheFingerprint
              ? { previousFingerprint: state.actualCacheFingerprint }
              : {}),
            onFingerprint: (fp) => {
              void updateState(config, (fresh) => {
                fresh.actualCacheFingerprint = fp;
              });
            },
          });
          try {
            actualAccounts = await session.listAccounts();
          } finally {
            await session.shutdown();
          }
          await updateState(config, (fresh) => {
            fresh.actualAccountsCache = {
              accounts: actualAccounts,
              fetchedAt: new Date().toISOString(),
              syncId: config.actual.syncId,
            };
          });
        } catch (err: any) {
          return json(200, {
            ok: true,
            reports,
            actualError: `Bank accounts refreshed, but Actual could not be reached: ${err.message}`,
          });
        }

        return json(200, { ok: true, reports, actualAccounts });
      } catch (err: any) {
        return fail(500, err.message);
      }
    }

    // --- Bank authorisation ---
    if (pathname === "/api/truelayer/auth-url" && req.method === "GET") {
      prunePending();
      const connectionId = parsedUrl.searchParams.get("connectionId") ?? undefined;
      const pending: PendingAuth = {
        id: randomUUID(),
        ...(connectionId ? { connectionId } : {}),
        createdAt: Date.now(),
        status: "waiting",
      };
      pendingAuths.set(pending.id, pending);
      return json(200, {
        url: buildAuthUrl(
          config.truelayer,
          usesServerCallback ? pending.id : undefined,
        ),
        pending: pending.id,
        flow: usesServerCallback ? "callback" : "paste",
      });
    }

    if (pathname === CALLBACK_PATH && req.method === "GET") {
      const code = parsedUrl.searchParams.get("code");
      const stateParam = parsedUrl.searchParams.get("state") ?? "";
      const pending = pendingAuths.get(stateParam);
      const finish = (message: string, ok: boolean) => {
        res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html" });
        res.end(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Actual Sync</title></head>` +
            `<body style="background:#080c14;color:#f3f4f6;font-family:system-ui,sans-serif;display:flex;` +
            `align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">` +
            `<div><h2>${message}</h2><p style="color:#9ca3af">You can close this tab and return to the dashboard.</p></div>` +
            `</body></html>`,
        );
      };

      if (!pending) {
        return finish("This authorisation link has expired. Start again from the dashboard.", false);
      }
      if (!code) {
        const reason =
          parsedUrl.searchParams.get("error_description") ??
          parsedUrl.searchParams.get("error") ??
          "The bank did not return an authorization code.";
        pending.status = "error";
        pending.error = reason;
        return finish(reason, false);
      }

      try {
        const { report } = await completeConnection(config, {
          code,
          ...(pending.connectionId ? { connectionId: pending.connectionId } : {}),
        });
        pending.status = "done";
        pending.report = report;
        return finish("Bank connected.", true);
      } catch (err: any) {
        pending.status = "error";
        pending.error = err.message;
        return finish(`Could not complete the connection: ${err.message}`, false);
      }
    }

    if (pathname.startsWith("/api/truelayer/pending/") && req.method === "GET") {
      const id = decodeURIComponent(
        pathname.substring("/api/truelayer/pending/".length),
      );
      const pending = pendingAuths.get(id);
      if (!pending) return fail(404, "That authorisation has expired.");
      if (pending.status === "done") {
        pendingAuths.delete(id);
        return json(200, { status: "done", report: pending.report });
      }
      if (pending.status === "error") {
        pendingAuths.delete(id);
        return json(200, { status: "error", error: pending.error });
      }
      return json(200, { status: "waiting" });
    }

    if (pathname === "/api/truelayer/exchange" && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const code = extractAuthCode(String(body?.code ?? ""));
        if (!code) return fail(400, "No authorization code was provided.");
        const result = await completeConnection(config, {
          code,
          ...(body?.connectionId ? { connectionId: body.connectionId } : {}),
          ...(body?.label ? { label: body.label } : {}),
        });
        return json(200, { ok: true, ...result });
      } catch (err: any) {
        return fail(400, err.message);
      }
    }

    // --- Sync execution ---
    if (pathname === "/api/status" && req.method === "GET") {
      if (isK8s) {
        try {
          // Verify we can read the CronJob
          await k8sRequest(
            k8s,
            "GET",
            `/apis/batch/v1/namespaces/${k8s.namespace}/cronjobs/${cronjobName}`
          );
          return json(200, {
            enabled: true,
            mode: "Kubernetes",
            cronjob: cronjobName,
            namespace: k8s.namespace,
          });
        } catch (err: any) {
          return json(200, {
            enabled: false,
            mode: "Kubernetes",
            cronjob: cronjobName,
            namespace: k8s.namespace,
            error: err.message,
          });
        }
      }
      return json(200, {
        enabled: true,
        mode: "Local",
        cronjob: cronjobName,
        namespace: "default",
      });
    }

    if (pathname === "/api/run" && req.method === "POST") {
      if (isK8s) {
        try {
          // 1. Fetch the CronJob template
          const cronjob = await k8sRequest(
            k8s,
            "GET",
            `/apis/batch/v1/namespaces/${k8s.namespace}/cronjobs/${cronjobName}`
          );

          // 2. Generate a unique name
          const uniqueId = Math.random().toString(36).substring(2, 8);
          const jobId = `${cronjobName}-manual-${uniqueId}`;

          // 3. Construct the Job manifest
          const jobManifest = {
            apiVersion: "batch/v1",
            kind: "Job",
            metadata: {
              name: jobId,
              namespace: k8s.namespace,
              ownerReferences: [
                {
                  apiVersion: cronjob.apiVersion || "batch/v1",
                  blockOwnerDeletion: true,
                  controller: false,
                  kind: cronjob.kind || "CronJob",
                  name: cronjob.metadata.name,
                  uid: cronjob.metadata.uid,
                },
              ],
              labels: {
                "app.kubernetes.io/managed-by": "actual-sync-dashboard",
                "cronjob-name": cronjobName,
              },
            },
            spec: {
              template: cronjob.spec.jobTemplate.spec.template,
              backoffLimit: 0,
            },
          };

          // 4. Submit the Job
          await k8sRequest(
            k8s,
            "POST",
            `/apis/batch/v1/namespaces/${k8s.namespace}/jobs`,
            jobManifest
          );

          return json(200, { success: true, job_id: jobId, mode: "Kubernetes" });
        } catch (err: any) {
          return fail(500, `Failed to trigger K8s job: ${err.message}`);
        }
      }

      // Local Mode: Spawns the CLI as a subprocess
      const jobId = `${cronjobName}-manual-${Math.random().toString(36).substring(2, 8)}`;
      localJobs.set(jobId, { status: "pending", logs: "Initializing local process...\n" });

      const mainFile = process.argv[1];
      if (!mainFile) {
        localJobs.set(jobId, { status: "failed", logs: "Cannot locate the actual-sync entry point." });
        return fail(500, "Cannot locate the actual-sync entry point.");
      }

      try {
        const cp = spawn(process.execPath, [mainFile, "sync"], {
          env: { ...process.env, DASHBOARD_DATA_DIR: dashboardDir },
        });

        localJobs.set(jobId, {
          status: "running",
          logs: `Starting local actual-sync-minimal process (${jobId})...\n----------------------------------------------------------\n`,
        });

        const append = (data: Buffer) => {
          const job = localJobs.get(jobId);
          if (job) {
            job.logs = (job.logs + data.toString()).slice(-100000); // Keep last 100k chars
            localJobs.set(jobId, job);
          }
        };
        cp.stdout.on("data", append);
        cp.stderr.on("data", append);

        cp.on("close", (code) => {
          const job = localJobs.get(jobId);
          if (job) {
            job.status = code === 0 ? "success" : "failed";
            job.logs += `\n----------------------------------------------------------\nProcess exited with code ${code}.\n`;
            localJobs.set(jobId, job);
          }
        });

        return json(200, { success: true, job_id: jobId, mode: "Local" });
      } catch (err: any) {
        localJobs.set(jobId, { status: "failed", logs: `Process spawn failed: ${err.message}` });
        return fail(500, `Failed to trigger local sync: ${err.message}`);
      }
    }

    if (pathname.startsWith("/api/logs/") && req.method === "GET") {
      const jobId = pathname.substring("/api/logs/".length);
      if (!jobId) {
        return fail(400, "Missing job ID");
      }

      if (isK8s) {
        // K8s Log Retrieval
        if (k8sJobLogsCache.has(jobId)) {
          return json(200, k8sJobLogsCache.get(jobId)!);
        }

        try {
          // 1. Get Job status
          const job = await k8sRequest(
            k8s,
            "GET",
            `/apis/batch/v1/namespaces/${k8s.namespace}/jobs/${jobId}`
          );

          const jobFailed = job.status.failed && job.status.failed > 0;
          const jobSuccess = job.status.succeeded && job.status.succeeded > 0;

          // 2. Find the pod
          const podList = await k8sRequest(
            k8s,
            "GET",
            `/api/v1/namespaces/${k8s.namespace}/pods?labelSelector=job-name=${jobId}`
          );

          if (!podList.items || podList.items.length === 0) {
            if (jobFailed) {
              const result: JobInfo = { status: "failed", logs: "Job failed. Pod was deleted before logs could be read." };
              k8sJobLogsCache.set(jobId, result);
              return json(200, result);
            } else if (jobSuccess) {
              const result: JobInfo = { status: "success", logs: "Job completed successfully." };
              k8sJobLogsCache.set(jobId, result);
              return json(200, result);
            }
            return json(200, { status: "pending", logs: "Job queued. Waiting for pod..." });
          }

          const pod = podList.items[0];
          const podName = pod.metadata.name;
          const phase = pod.status.phase;

          if (phase === "Pending") {
            return json(200, { status: "pending", logs: "Pod starting up (Pending)..." });
          }

          // Fetch pod logs
          let logsText = "";
          try {
            logsText = await k8sRequest(
              k8s,
              "GET",
              `/api/v1/namespaces/${k8s.namespace}/pods/${podName}/log`
            );
          } catch (logErr: any) {
            logsText = `Waiting for logs: ${logErr.message}`;
          }

          let status: "pending" | "running" | "success" | "failed" = "running";
          if (phase === "Succeeded" || jobSuccess) {
            status = "success";
          } else if (phase === "Failed" || jobFailed) {
            status = "failed";
          }

          const responseObj: JobInfo = { status, logs: logsText };
          if (status === "success" || status === "failed") {
            k8sJobLogsCache.set(jobId, responseObj);
          }

          return json(200, responseObj);
        } catch (err: any) {
          return fail(500, `Failed to fetch K8s logs: ${err.message}`);
        }
      }

      // Local Log Retrieval
      const job = localJobs.get(jobId);
      if (job) return json(200, job);
      return fail(404, "Job ID not found");
    }

    // --- Not Found ---
    return fail(404, "Path not found");
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(chalk.green(`Server running at http://0.0.0.0:${port}/`));
    if (usesServerCallback) {
      console.log(
        chalk.gray(`TrueLayer redirects are handled at ${config.truelayer.redirectUri}`),
      );
    }
  });
};
