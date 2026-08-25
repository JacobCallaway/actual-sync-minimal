import * as api from "@actual-app/api";
import { mkdir, rm } from "fs/promises";
import { createHash } from "crypto";
import chalk from "chalk";

export type ActualConfig = {
  syncId: string;
  password: string;
  url: string;
  cacheDir: string;
  apiVersion?: string;
};

export type ActualTransaction = {
  /** Required. The ID of the account this transaction belongs to */
  account: string;
  /** Required. Transaction date in YYYY-MM-DD format */
  date: string;
  /** A currency amount as an integer representing the value without decimal places.
   * For example, USD amount of $120.30 would be 12030 */
  amount: number;
  /** If given, a payee will be created with this name.
   * If this matches an already existing payee, that payee will be used.
   * Only available in create/import requests */
  payee_name: string;
  /** Any additional notes for the transaction */
  notes: string;
  /** A unique id usually given by the bank, if importing.
   * Use this to avoid duplicate transactions */
  imported_id: string;
  /** A flag indicating if the transaction has cleared or not */
  cleared?: boolean;
};

/** Normalize a server URL by ensuring it has an http/https protocol prefix. */
const normalizeUrl = (url: string): string => {
  if (/^https?:\/\//i.test(url)) return url;
  console.warn(
    `Warning: Actual server URL "${url}" has no protocol — assuming "http://". Set a full URL (e.g. "http://${url}") in your config to suppress this warning.`,
  );
  return `http://${url}`;
};

/** Identifies which server and budget the local cache directory was built for. */
export const cacheFingerprint = (config: ActualConfig): string =>
  createHash("sha256")
    .update(`${normalizeUrl(config.url)}|${config.syncId}`)
    .digest("hex")
    .slice(0, 16);

/** Open a session to the Actual Budget API.
 * The session initialises and downloads the budget once.
 * Call `shutdown()` when done to sync and close the budget. */
export const openActualSession = async (
  config: ActualConfig,
  opts: { onFingerprint?: (fingerprint: string) => void; previousFingerprint?: string } = {},
) => {
  const serverURL = normalizeUrl(config.url);
  const fingerprint = cacheFingerprint(config);

  // The cache directory holds a budget downloaded for one server+budget pair.
  // Pointing the config at a different one leaves that cache stale, which
  // surfaces later as a confusing failure inside downloadBudget. Clear it here
  // instead, where we can say why.
  if (opts.previousFingerprint && opts.previousFingerprint !== fingerprint) {
    console.log(
      chalk.yellow(
        `Actual server or budget changed since the last run — clearing the stale cache at ${config.cacheDir}`,
      ),
    );
    await rm(config.cacheDir, { recursive: true, force: true });
  }

  await mkdir(config.cacheDir, { recursive: true });
  try {
    await api.init({
      dataDir: config.cacheDir,
      serverURL,
      password: config.password,
      verbose: false,
    });
  } catch (err) {
    throw new Error(
      `Failed to connect to Actual server at "${serverURL}": ${err instanceof Error ? err.message : err}. Check the "actual.url" and "actual.password" values in your config.`,
    );
  }
  await api.downloadBudget(config.syncId);
  opts.onFingerprint?.(fingerprint);

  const listAccounts = async () => {
    const accounts = await api.getAccounts();
    return accounts.map((a) => ({ name: a.name, id: a.id }));
  };

  const loadTransactions = async (
    accountId: string,
    txs: ActualTransaction[],
  ) => {
    const res = await api.importTransactions(accountId, txs);
    return {
      errors: (res.errors as []).length,
      added: (res.added as []).length,
      updated: (res.updated as []).length,
      updatedPreview: (res.updatedPreview as []).length,
    };
  };

  const getBalance = async (accountId: string) => {
    return await api.getAccountBalance(accountId);
  };

  const shutdown = async () => {
    await api.shutdown();
  };

  return { listAccounts, loadTransactions, getBalance, shutdown };
};
