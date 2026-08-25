export class TruelayerConnectionExpiredError extends Error {
  readonly connectionId: string | undefined;
  constructor(accountName?: string, connectionId?: string) {
    const target = accountName ? ` for "${accountName}"` : "";
    super(
      `The connection to the bank${target} has expired. ` +
        `Reconnect it from the dashboard, or run: actual-sync connections reconnect`,
    );
    this.name = "TruelayerConnectionExpiredError";
    this.connectionId = connectionId;
  }
}

export type TruelayerConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accounts: TruelayerBankAccount[];
};

export type TruelayerBankAccount = {
  id: string;
  name: string;
  refreshToken: string;
  type: "CARD" | "ACCOUNT";
};

/** The minimum a caller must hand us to act on a connection's behalf. Kept
 * structural so this module stays independent of the state store. */
export type ConnectionRef = {
  id: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
};

/** An account discovered at TrueLayer, before it is reconciled into state. */
export type DiscoveredAccount = {
  id: string;
  name: string;
  type: "CARD" | "ACCOUNT";
  network?: string;
};

export type TruelayerTransaction = {
  timestamp: string; // "2025-09-14T00:00:00Z"
  description: string;
  transaction_type: string;
  transaction_category: string;
  amount: number; // 8.98
  currency: string; // "GBP",
  transaction_id: string;
  transaction_status?: "SETTLED" | "PENDING" | string;
  provider_transaction_id?: string;
  normalised_provider_transaction_id?: string;
  meta: {
    provider_merchant_name?: string;
    counter_party_preferred_name?: string;
    address: string;
    transaction_type: string;
    provider_reference?: string;
    provider_id?: string;
  };
};

type TruelayerResponse<T> = {
  results: T[];
  status: "Succeeded";
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

/** Refresh this many seconds before the access token actually lapses, so a
 * token cannot expire in flight between our check and TrueLayer's. */
const EXPIRY_SKEW_SECONDS = 60;

/** Called whenever TrueLayer hands back new tokens for a connection. Awaited
 * *before* the tokens are used, so a rotated refresh token is never lost. */
export type TokenSink = (
  connectionId: string,
  tokens: Tokens,
) => Promise<void> | void;

export const buildAuthUrl = (
  config: TruelayerConfig,
  state?: string,
): string => {
  const u = new URL("https://auth.truelayer.com");
  u.searchParams.append("response_type", "code");
  u.searchParams.append("client_id", config.clientId);
  u.searchParams.append(
    "scope",
    "info accounts balance cards transactions direct_debits standing_orders offline_access",
  );
  u.searchParams.append("redirect_uri", config.redirectUri);
  u.searchParams.append("providers", "uk-ob-all uk-oauth-all");
  if (state) u.searchParams.append("state", state);
  return u.toString();
};

export const Truelayer = (
  config: TruelayerConfig,
  opts: { onTokens?: TokenSink } = {},
) => {
  const BASE_URL_API = "https://api.truelayer.com";
  const { refreshToken, swapCodeForTokens } = TruelayerAuth(config);

  const listAccounts = () => config.accounts;

  /** Cached access tokens by connection id, plus the in-flight refresh for
   * each so concurrent callers share one round trip instead of racing. */
  const cache = new Map<string, Tokens>();
  const inFlight = new Map<string, Promise<Tokens>>();

  /** Seed the cache from a connection that already carries a live token, so a
   * freshly loaded process does not refresh needlessly. */
  const primeCache = (connection: ConnectionRef) => {
    if (
      connection.accessToken &&
      connection.accessTokenExpiresAt &&
      !cache.has(connection.id)
    ) {
      cache.set(connection.id, {
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        expiresAt: connection.accessTokenExpiresAt,
      });
    }
  };

  const isFresh = (tokens: Tokens): boolean =>
    new Date(tokens.expiresAt).getTime() - EXPIRY_SKEW_SECONDS * 1000 >
    Date.now();

  const getAccessToken = async (connection: ConnectionRef): Promise<string> => {
    primeCache(connection);
    const cached = cache.get(connection.id);
    if (cached && isFresh(cached)) return cached.accessToken;

    const pending = inFlight.get(connection.id);
    if (pending) return (await pending).accessToken;

    const promise = (async () => {
      const tokens = await refreshToken(
        cached?.refreshToken ?? connection.refreshToken,
        connection.id,
      );
      // Persist before use: if this throws we would rather fail the sync than
      // carry on with a rotated refresh token that never reached disk.
      await opts.onTokens?.(connection.id, tokens);
      cache.set(connection.id, tokens);
      return tokens;
    })().finally(() => inFlight.delete(connection.id));

    inFlight.set(connection.id, promise);
    return (await promise).accessToken;
  };

  /** Drop any cached access token for a connection — used when its key changes. */
  const invalidate = (connectionId: string) => {
    cache.delete(connectionId);
    inFlight.delete(connectionId);
  };

  const truelayerApi = async <T>(
    path: string,
    auth: ConnectionRef | { accessToken: string },
  ): Promise<TruelayerResponse<T> | null> => {
    const isRef = "id" in auth;
    const accessToken = isRef
      ? await getAccessToken(auth)
      : auth.accessToken;
    const resp = await fetch(new URL(path, BASE_URL_API), {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        // The cached token is no good either way; force a refresh next time.
        if (isRef) invalidate(auth.id);
        throw new TruelayerConnectionExpiredError(
          undefined,
          isRef ? auth.id : undefined,
        );
      }
      return null;
    }
    return (await resp.json()) as TruelayerResponse<T>;
  };

  /** Discover the accounts a consent covers. TrueLayer splits cards and
   * accounts across two endpoints; that distinction is hidden here.
   * e.g. Monzo is an account, Amex is a card. */
  const getInfo = async (
    auth: ConnectionRef | { accessToken: string },
  ): Promise<DiscoveredAccount[]> => {
    type CardAccountResponse = {
      display_name: string;
      account_id: string;
      card_network: string;
    };
    let isCard = true;
    let data = await truelayerApi<CardAccountResponse>(`data/v1/cards/`, auth);
    if (!data || data.results.length === 0) {
      isCard = false;
      data = await truelayerApi<CardAccountResponse>(`data/v1/accounts/`, auth);
    }
    return (
      data?.results.map((c) => ({
        id: c.account_id,
        name: c.display_name,
        network: c.card_network,
        type: (isCard ? "CARD" : "ACCOUNT") as "CARD" | "ACCOUNT",
      })) ?? []
    );
  };

  /** Exchange an authorization code for tokens and the accounts they unlock. */
  const completeAuth = async (
    code: string,
  ): Promise<{ tokens: Tokens; accounts: DiscoveredAccount[] }> => {
    const tokens = await swapCodeForTokens(code);
    const accounts = await getInfo({ accessToken: tokens.accessToken });
    if (accounts.length === 0) {
      throw new Error(
        "Authentication succeeded but TrueLayer returned no accounts. " +
          "Check that the consent covers at least one account or card.",
      );
    }
    return { tokens, accounts };
  };

  const addAccounts = async (): Promise<TruelayerBankAccount[]> => {
    const code = await promptForAuthCode(config);
    const { tokens, accounts } = await completeAuth(code);
    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      refreshToken: tokens.refreshToken,
    }));
  };

  const endpoint = (
    account: { id: string; type: "CARD" | "ACCOUNT" },
    resource: "transactions" | "balance",
  ) =>
    account.type === "CARD"
      ? `/data/v1/cards/${account.id}/${resource}`
      : `/data/v1/accounts/${account.id}/${resource}`;

  const getTransactions = async (
    account: { id: string; type: "CARD" | "ACCOUNT" },
    connection: ConnectionRef,
  ) =>
    await truelayerApi<TruelayerTransaction>(
      endpoint(account, "transactions"),
      connection,
    ).then((res) => res?.results ?? []);

  const getBalance = async (
    account: { id: string; type: "CARD" | "ACCOUNT" },
    connection: ConnectionRef,
  ) => {
    const data = await truelayerApi<{ current: number; currency?: string }>(
      endpoint(account, "balance"),
      connection,
    );
    if (!data || data.results.length !== 1)
      throw Error("Only one balance per account expected");
    return data.results[0]!;
  };

  return {
    addAccounts,
    completeAuth,
    getAccounts: getInfo,
    getTransactions,
    getBalance,
    listAccounts,
    getAccessToken,
    invalidate,
  };
};

/** Pull the authorization code out of whatever the user pasted. The redirect
 * page shows a full URL, and pasting the whole thing is the common case. */
export const extractAuthCode = (raw: string): string => {
  const code = raw.trim();
  if (!code.includes("code=")) return code;
  try {
    const parsed = new URL(code.includes("://") ? code : `http://x/?${code}`);
    return parsed.searchParams.get("code") ?? code;
  } catch {
    return code;
  }
};

/** Interactive CLI prompt for the authorization code. Server flows use
 * `buildAuthUrl` plus the callback or paste endpoint instead. */
export const promptForAuthCode = async (
  config: TruelayerConfig,
): Promise<string> => {
  console.log(`Navigate to:\n${buildAuthUrl(config)}`);
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    readline.question("Paste the code here\n> ", (raw: string) => {
      readline.close();
      resolve(extractAuthCode(raw));
    });
  });
};

const TruelayerAuth = (config: TruelayerConfig) => {
  const BASE_URL_AUTH = "https://auth.truelayer.com";

  const toTokens = (data: TokenResponse, previousRefresh: string): Tokens => ({
    accessToken: data.access_token,
    // TrueLayer only returns a refresh token when it rotates one; keeping the
    // previous value is what makes an unrotated response a no-op.
    refreshToken: data.refresh_token ?? previousRefresh,
    expiresAt: new Date(
      Date.now() + (data.expires_in ?? 3600) * 1000,
    ).toISOString(),
  });

  const swapCodeForTokens = async (code: string): Promise<Tokens> => {
    const resp = await fetch(new URL("/connect/token", BASE_URL_AUTH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code: code,
      }),
    });
    if (!resp.ok) {
      throw new Error(
        `Failed to exchange the TrueLayer authorization code (HTTP ${resp.status}): ${await resp.text()}`,
      );
    }
    const data = (await resp.json()) as TokenResponse;
    if (!data.refresh_token) {
      throw new Error(
        "TrueLayer returned no refresh token. The consent must include the " +
          '"offline_access" scope for unattended syncing.',
      );
    }
    return toTokens(data, data.refresh_token);
  };

  const refreshToken = async (
    current: string,
    connectionId?: string,
  ): Promise<Tokens> => {
    const resp = await fetch(new URL("/connect/token", BASE_URL_AUTH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: current,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      if (
        resp.status === 400 ||
        resp.status === 401 ||
        body.includes("invalid_grant") ||
        body.includes("token_expired") ||
        body.includes("consent")
      ) {
        throw new TruelayerConnectionExpiredError(undefined, connectionId);
      }
      throw new Error(
        `Failed to refresh TrueLayer token (HTTP ${resp.status}): ${body}`,
      );
    }
    return toTokens((await resp.json()) as TokenResponse, current);
  };

  return { swapCodeForTokens, refreshToken };
};
