import { randomUUID } from "crypto";
import { AppConfig } from "./config";
import {
  Connection,
  Mapping,
  StateFile,
  consentExpiryFrom,
  loadState,
  updateState,
} from "./state";
import { ConsentInfo, DiscoveredAccount, Tokens, Truelayer } from "./truelayer";

/** What changed when a connection's accounts were reconciled after a re-auth.
 * Surfaced to the user so an id change never happens silently. */
export type ReconcileReport = {
  connectionId: string;
  label: string;
  /** Accounts whose TrueLayer id changed; mappings were rewritten to follow. */
  remapped: { name: string; from: string; to: string; mappings: number }[];
  /** Accounts newly visible through this consent. */
  added: { id: string; name: string }[];
  /** Accounts we knew about that the consent no longer covers. */
  missing: { id: string; name: string; mappings: number }[];
  /** Accounts with no mapping yet — the GUI prompts to map these. */
  unmapped: { id: string; name: string }[];
};

const normalise = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Match a previously-known account to one in the freshly discovered set.
 * Banks reissue account ids on re-consent, so identity falls back from the id
 * to the name+type pair, then to the name alone. */
const findMatch = (
  known: { id: string; name: string; type: "CARD" | "ACCOUNT" },
  discovered: DiscoveredAccount[],
  taken: Set<string>,
): DiscoveredAccount | undefined => {
  const free = discovered.filter((d) => !taken.has(d.id));
  return (
    free.find((d) => d.id === known.id) ??
    free.find(
      (d) => d.type === known.type && normalise(d.name) === normalise(known.name),
    ) ??
    free.find((d) => normalise(d.name) === normalise(known.name))
  );
};

/** Fold a freshly discovered account list into a connection, rewriting any
 * mappings whose TrueLayer id moved. Mutates `connection` and `map` in place;
 * callers run this inside `updateState` so the whole thing lands atomically. */
export const reconcileAccounts = (
  connection: Connection,
  discovered: DiscoveredAccount[],
  map: Mapping[],
): ReconcileReport => {
  const now = new Date().toISOString();
  const report: ReconcileReport = {
    connectionId: connection.id,
    label: connection.label,
    remapped: [],
    added: [],
    missing: [],
    unmapped: [],
  };

  const taken = new Set<string>();
  const mine = map.filter((m) => m.connectionId === connection.id);

  for (const known of connection.accounts) {
    const match = findMatch(known, discovered, taken);
    if (!match) {
      report.missing.push({
        id: known.id,
        name: known.name,
        mappings: mine.filter((m) => m.truelayerAccountId === known.id).length,
      });
      continue;
    }
    taken.add(match.id);
    if (match.id !== known.id) {
      const affected = mine.filter((m) => m.truelayerAccountId === known.id);
      for (const mapping of affected) mapping.truelayerAccountId = match.id;
      report.remapped.push({
        name: match.name,
        from: known.id,
        to: match.id,
        mappings: affected.length,
      });
    }
  }

  for (const account of discovered) {
    if (!taken.has(account.id)) {
      report.added.push({ id: account.id, name: account.name });
    }
  }

  // The discovered list is now the truth about what this consent covers.
  connection.accounts = discovered.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    lastSeenAt: now,
  }));

  const mapped = new Set(mine.map((m) => m.truelayerAccountId));
  report.unmapped = connection.accounts
    .filter((a) => !mapped.has(a.id))
    .map((a) => ({ id: a.id, name: a.name }));

  return report;
};

/** True when a label was auto-derived rather than chosen by the user, so it is
 * safe to replace with the provider's real name. */
const isAutoLabel = (connection: Connection): boolean =>
  /^Bank \(\d+ accounts\)$/.test(connection.label) ||
  connection.accounts.some((a) => a.name === connection.label);

/** Record what TrueLayer says about the consent. Its expiry is authoritative;
 * the 90-day fallback is only for providers that do not report one. */
export const applyConsent = (
  connection: Connection,
  consent: ConsentInfo | null,
) => {
  if (!consent) return;
  if (consent.consentCreatedAt) connection.connectedAt = consent.consentCreatedAt;
  if (consent.consentExpiresAt) {
    connection.consentExpiresAt = consent.consentExpiresAt;
  } else if (consent.consentCreatedAt) {
    connection.consentExpiresAt = consentExpiryFrom(consent.consentCreatedAt);
  }
  // The provider's own name beats a label derived from an account name.
  if (consent.providerName && isAutoLabel(connection)) {
    connection.label = consent.providerName;
  }
  const status = consent.consentStatus?.toLowerCase();
  if (status && status !== "authorised" && status !== "authorized") {
    connection.status = "expired";
    connection.lastRefreshError = `TrueLayer reports consent status "${consent.consentStatus}"`;
  }
};

/** Apply fresh tokens to a connection and clear the failure state that a
 * previous expiry left behind. */
const applyTokens = (connection: Connection, tokens: Tokens) => {
  const now = new Date().toISOString();
  connection.refreshToken = tokens.refreshToken;
  connection.accessToken = tokens.accessToken;
  connection.accessTokenExpiresAt = tokens.expiresAt;
  connection.lastRefreshAt = now;
  delete connection.lastRefreshError;
};

/** Complete an authorization code exchange, either creating a new connection
 * or refreshing the key of an existing one.
 *
 * Everything after the network calls happens inside a single `updateState`
 * transaction, so a failure at any point leaves the previous state untouched
 * rather than half-updated. */
export const completeConnection = async (
  config: AppConfig,
  opts: { code: string; connectionId?: string; label?: string },
): Promise<{ connectionId: string; report: ReconcileReport }> => {
  const truelayer = Truelayer(config.truelayer);
  // Network first: nothing is written until we know the code was good.
  const { tokens, accounts, consent } = await truelayer.completeAuth(opts.code);

  return updateState(config, (state) => {
    const now = new Date().toISOString();
    let connection = opts.connectionId
      ? state.connections.find((c) => c.id === opts.connectionId)
      : undefined;

    if (opts.connectionId && !connection) {
      throw new Error(`Connection "${opts.connectionId}" no longer exists.`);
    }

    if (!connection) {
      // A repeat consent for a bank we already hold should update that
      // connection rather than creating a duplicate alongside it.
      connection = state.connections.find((c) =>
        c.accounts.some((a) => accounts.some((d) => d.id === a.id)),
      );
    }

    if (!connection) {
      connection = {
        id: randomUUID(),
        label:
          opts.label ??
          consent?.providerName ??
          (accounts.length === 1
            ? accounts[0]!.name
            : `Bank (${accounts.length} accounts)`),
        refreshToken: tokens.refreshToken,
        connectedAt: now,
        status: "active",
        accounts: [],
      };
      state.connections.push(connection);
    }

    if (opts.label) connection.label = opts.label;
    applyTokens(connection, tokens);
    connection.connectedAt = now;
    connection.consentExpiresAt = consentExpiryFrom(now);
    connection.status = "active";
    // Overwrite the assumed dates with what TrueLayer actually reports.
    applyConsent(connection, consent);
    if (opts.label) connection.label = opts.label;

    const report = reconcileAccounts(connection, accounts, state.map);
    // The old access token belonged to the previous consent.
    truelayer.invalidate(connection.id);
    return { connectionId: connection.id, report };
  });
};

/** Record that a connection's key is no longer usable, so the GUI and the next
 * sync can report it without retrying a key we know is dead. */
export const markExpired = (
  config: AppConfig,
  connectionId: string,
  reason: string,
): Promise<void> =>
  updateState(config, (state) => {
    const connection = state.connections.find((c) => c.id === connectionId);
    if (connection) {
      connection.status = "expired";
      connection.lastRefreshError = reason;
    }
  });

/** Persist rotated tokens. Wired into the TrueLayer client as its `onTokens`
 * sink so a rotation is durable before the access token is ever used. */
export const persistTokens = (
  config: AppConfig,
  connectionId: string,
  tokens: Tokens,
): Promise<void> =>
  updateState(config, (state) => {
    const connection = state.connections.find((c) => c.id === connectionId);
    if (!connection) return;
    applyTokens(connection, tokens);
    if (connection.status === "expired") connection.status = "active";
  });

export const removeConnection = (
  config: AppConfig,
  connectionId: string,
): Promise<{ removedMappings: number }> =>
  updateState(config, (state) => {
    const before = state.map.length;
    state.connections = state.connections.filter((c) => c.id !== connectionId);
    state.map = state.map.filter((m) => m.connectionId !== connectionId);
    return { removedMappings: before - state.map.length };
  });

/** Re-fetch the account list for every live connection, reconciling each. Used
 * by the GUI's refresh button so pickers reflect what the bank shows today. */
export const refreshAllAccounts = async (
  config: AppConfig,
): Promise<ReconcileReport[]> => {
  const state = loadState(config);
  const truelayer = Truelayer(config.truelayer, {
    onTokens: (id, tokens) => persistTokens(config, id, tokens),
  });

  const discovered = new Map<string, DiscoveredAccount[]>();
  const consents = new Map<string, ConsentInfo | null>();
  const failures = new Map<string, string>();

  for (const connection of state.connections) {
    try {
      consents.set(
        connection.id,
        await truelayer.getConsent(connection).catch(() => null),
      );
      discovered.set(connection.id, await truelayer.getAccounts(connection));
    } catch (err) {
      failures.set(
        connection.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return updateState(config, (fresh: StateFile) => {
    const reports: ReconcileReport[] = [];
    for (const connection of fresh.connections) {
      const accounts = discovered.get(connection.id);
      if (accounts) {
        reports.push(reconcileAccounts(connection, accounts, fresh.map));
        applyConsent(connection, consents.get(connection.id) ?? null);
        continue;
      }
      const failure = failures.get(connection.id);
      if (failure) {
        connection.status = "expired";
        connection.lastRefreshError = failure;
      }
    }
    return reports;
  });
};
