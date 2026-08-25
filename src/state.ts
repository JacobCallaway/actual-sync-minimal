import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AppConfig } from "./config";
import { TruelayerBankAccount } from "./truelayer";

/** TrueLayer consent lasts 90 days from the moment it is granted. */
export const CONSENT_DURATION_DAYS = 90;
/** A connection is flagged as "expiring" this many days before consent lapses. */
export const EXPIRY_WARNING_DAYS = 7;

export type ConnectionStatus = "active" | "expiring" | "expired" | "unknown";

/** A bank account as last seen through a connection. Cached so the GUI can
 * offer name-based pickers without hitting TrueLayer on every page load. */
export type CachedBankAccount = {
  id: string;
  name: string;
  type: "CARD" | "ACCOUNT";
  lastSeenAt: string;
};

/** One TrueLayer consent, covering every account the user shared through it.
 * The `id` is ours and stays stable across re-authentication, which is what
 * lets mappings survive a reconnect even when the bank reissues account ids. */
export type Connection = {
  id: string;
  label: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  connectedAt: string;
  consentExpiresAt?: string;
  lastRefreshAt?: string;
  lastRefreshError?: string;
  status: ConnectionStatus;
  accounts: CachedBankAccount[];
};

export type Mapping = {
  id: string;
  name: string;
  connectionId: string;
  truelayerAccountId: string;
  actualAccountId: string;
  mapConfig: { invertAmount?: boolean };
  enabled: boolean;
};

export type ActualAccountsCache = {
  accounts: { id: string; name: string }[];
  fetchedAt: string;
  syncId: string;
};

export type StateFile = {
  version: 1;
  connections: Connection[];
  map: Mapping[];
  actualAccountsCache?: ActualAccountsCache;
  /** Fingerprint of the Actual server url + syncId the cacheDir was built for. */
  actualCacheFingerprint?: string;
};

const EMPTY_STATE: StateFile = { version: 1, connections: [], map: [] };

/** Where mutable state lives. In the container image this is the mounted data
 * volume; run from a checkout there is no /app, so fall back to a directory
 * beside the config rather than a path we cannot create. */
export const stateDir = (): string =>
  process.env.STATE_DIR ??
  process.env.DASHBOARD_DATA_DIR ??
  (fs.existsSync("/app") ? "/app/data" : ".data");

export const statePath = (): string => path.join(stateDir(), "state.json");

/** Days until consent lapses, or null when we have no expiry on record. */
export const daysUntilExpiry = (connection: Connection): number | null => {
  if (!connection.consentExpiresAt) return null;
  const ms = new Date(connection.consentExpiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
};

/** Derive status from the consent clock. An explicit `expired` mark from a
 * failed refresh always wins — the bank is the authority, not our estimate. */
export const deriveStatus = (connection: Connection): ConnectionStatus => {
  if (connection.status === "expired") return "expired";
  const days = daysUntilExpiry(connection);
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= EXPIRY_WARNING_DAYS) return "expiring";
  return "active";
};

export const consentExpiryFrom = (connectedAt: string): string =>
  new Date(
    new Date(connectedAt).getTime() + CONSENT_DURATION_DAYS * 86_400_000,
  ).toISOString();

/** Strip secrets before anything leaves the process over HTTP. */
export const redactState = (state: StateFile) => ({
  ...state,
  connections: state.connections.map((c) => {
    const { refreshToken, accessToken, ...rest } = c;
    return {
      ...rest,
      status: deriveStatus(c),
      daysUntilExpiry: daysUntilExpiry(c),
      hasRefreshToken: Boolean(refreshToken),
    };
  }),
});

const readRaw = (): StateFile | null => {
  const file = statePath();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StateFile;
    return {
      ...EMPTY_STATE,
      ...parsed,
      connections: parsed.connections ?? [],
      map: parsed.map ?? [],
    };
  } catch (err) {
    throw new Error(
      `State file "${file}" is corrupt: ${err instanceof Error ? err.message : err}. ` +
        `Move it aside to start fresh — connections will need re-authenticating.`,
    );
  }
};

/** Build state from a legacy config, grouping accounts that share a refresh
 * token into one connection (they came from a single consent). */
export const migrateFromConfig = (config: AppConfig): StateFile => {
  const now = new Date().toISOString();
  const byToken = new Map<string, Connection>();

  for (const account of config.truelayer.accounts ?? []) {
    let connection = byToken.get(account.refreshToken);
    if (!connection) {
      connection = {
        id: randomUUID(),
        label: account.name,
        refreshToken: account.refreshToken,
        connectedAt: now,
        consentExpiresAt: consentExpiryFrom(now),
        status: "unknown",
        accounts: [],
      };
      byToken.set(account.refreshToken, connection);
    }
    connection.accounts.push({
      id: account.id,
      name: account.name,
      type: account.type,
      lastSeenAt: now,
    });
  }

  const connections = [...byToken.values()];
  // A connection covering several accounts is a bank, not a single account.
  for (const connection of connections) {
    if (connection.accounts.length > 1) {
      connection.label = `Bank (${connection.accounts.length} accounts)`;
    }
  }

  const map: Mapping[] = (config.sync.map ?? []).map((m) => ({
    id: randomUUID(),
    name: m.name,
    connectionId:
      connections.find((c) =>
        c.accounts.some((a) => a.id === m.truelayerAccountId),
      )?.id ?? "",
    truelayerAccountId: m.truelayerAccountId,
    actualAccountId: m.actualAccountId,
    mapConfig: m.mapConfig ?? {},
    enabled: true,
  }));

  return { version: 1, connections, map };
};

/** Load state, migrating a legacy config on first run.
 *
 * The migration is persisted immediately: it mints connection ids, and those
 * have to be stable from the very first command that shows them, not just from
 * whenever something happens to write. */
export const loadState = (config: AppConfig): StateFile => {
  const existing = readRaw();
  if (existing) return existing;

  const migrated = migrateFromConfig(config);
  try {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.state.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(migrated, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmp, statePath());
  } catch (err) {
    // A read-only or missing data dir should not stop a read-only command from
    // working; the ids just will not stick until the directory is writable.
    console.warn(
      `Warning: could not persist migrated state to ${statePath()}: ` +
        `${err instanceof Error ? err.message : err}`,
    );
  }
  return migrated;
};

/** Write the file out via a temp file + rename, so a crash mid-write can never
 * leave a half-written state file behind. */
const writeAtomic = async (state: StateFile): Promise<void> => {
  const dir = stateDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.state.${process.pid}.${Date.now()}.tmp`);
  await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.promises.rename(tmp, statePath());
};

let writeChain: Promise<unknown> = Promise.resolve();

/** Queue work behind every previous write, whether those settled or threw. */
const serialise = <T>(run: () => Promise<T>): Promise<T> => {
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => undefined);
  return next;
};

export const saveState = (state: StateFile): Promise<void> =>
  serialise(() => writeAtomic(state));

/** Read-modify-write under the same serialised chain. The mutator receives the
 * state as it exists on disk right now, so concurrent callers cannot clobber
 * each other's changes. Returns whatever the mutator returns. */
export const updateState = <T>(
  config: AppConfig,
  mutate: (state: StateFile) => T,
): Promise<T> =>
  serialise(async () => {
    const state = loadState(config);
    const result = mutate(state);
    await writeAtomic(state);
    return result;
  });

/** Flatten the connection-scoped accounts back into the shape the TrueLayer
 * client works with. */
export const bankAccountsOf = (
  connection: Connection,
): TruelayerBankAccount[] =>
  connection.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    refreshToken: connection.refreshToken,
  }));

export const findConnectionForAccount = (
  state: StateFile,
  truelayerAccountId: string,
): Connection | undefined =>
  state.connections.find((c) =>
    c.accounts.some((a) => a.id === truelayerAccountId),
  );
