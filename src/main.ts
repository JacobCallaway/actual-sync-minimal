#!/usr/bin/env node

// Polyfill global.navigator to prevent upstream @actual-app/api >=26.3.0 from crashing in Node.js
if (typeof (global as any).navigator === "undefined") {
  (global as any).navigator = { userAgent: "Node" };
}

import { program } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import * as YAML from "yaml";
import { loadConfig, createConfig } from "./config";
import type { ReconcileReport } from "./connections";

program.version("1.2.1-fork.1").description("Actual sync");

/** Print what a reconcile did, so an account-id change is never silent. */
const printReconcile = (report: ReconcileReport) => {
  console.log(chalk.green(`\n✅ Connected "${report.label}"`));
  for (const r of report.remapped) {
    console.log(
      chalk.yellow(
        `  ↻ ${r.name}: the bank issued a new account id; ${r.mappings} mapping(s) updated to follow.`,
      ),
    );
  }
  for (const a of report.added) {
    console.log(chalk.cyan(`  + ${a.name} is now covered by this connection.`));
  }
  for (const m of report.missing) {
    console.log(
      chalk.red(
        `  - ${m.name} is no longer shared by this consent` +
          (m.mappings ? ` (${m.mappings} mapping(s) now point at a missing account)` : ""),
      ),
    );
  }
  for (const a of report.unmapped) {
    console.log(chalk.yellow(`  ! ${a.name} is not mapped to an Actual account yet.`));
  }
  if (report.unmapped.length) {
    console.log(chalk.gray("\n  Map them with: actual-sync map add"));
  }
};

/** Resolve a connection by id or by a case-insensitive label match. */
const resolveConnection = (connections: { id: string; label: string }[], needle: string) => {
  const match =
    connections.find((c) => c.id === needle) ??
    connections.find((c) => c.label.toLowerCase() === needle.toLowerCase());
  if (!match) {
    console.error(chalk.red(`No connection matches "${needle}".`));
    console.error(chalk.gray("List them with: actual-sync connections list"));
    process.exit(1);
  }
  return match;
};

// Config
program
  .command("config")
  .command("create")
  .action(() => {
    inquirer
      .prompt({
        type: "confirm",
        name: "confirm",
        message:
          "Create default config file? (if a file exists it will be overwritten)",
      })
      .then(({ confirm }) => {
        if (confirm) createConfig();
      });
  });

// Actual
const actualCommand = program.command("actual");
actualCommand.command("list-accounts").action(async () => {
  const config = await loadConfig();
  const { alignApiDependency } = await import("./align");
  await alignApiDependency(config);

  const { openActualSession } = await import("./actual");
  const actual = await openActualSession(config.actual);
  try {
    const accounts = await actual.listAccounts();
    console.log(YAML.stringify(accounts, null, 2));
  } finally {
    await actual.shutdown();
  }
});

// Connections
const connectionsCommand = program
  .command("connections")
  .description("Manage bank connections and their keys");

connectionsCommand
  .command("list")
  .description("Show every bank connection and how long its consent has left")
  .action(async () => {
    const config = await loadConfig();
    const { loadState, deriveStatus, daysUntilExpiry } = await import("./state");
    const state = loadState(config);
    if (state.connections.length === 0) {
      console.log(chalk.yellow("No bank connections yet. Add one with: actual-sync connections add"));
      return;
    }
    for (const connection of state.connections) {
      const status = deriveStatus(connection);
      const days = daysUntilExpiry(connection);
      const colour =
        status === "expired" ? chalk.red : status === "expiring" ? chalk.yellow : chalk.green;
      console.log(
        `\n${chalk.bold(connection.label)}  ${colour(status.toUpperCase())}` +
          (days !== null ? chalk.gray(`  (${days} days left)`) : ""),
      );
      console.log(chalk.gray(`  id: ${connection.id}`));
      for (const account of connection.accounts) {
        console.log(`  · ${account.name} ${chalk.gray(`(${account.type})`)}`);
      }
      if (connection.lastRefreshError) {
        console.log(chalk.red(`  last error: ${connection.lastRefreshError}`));
      }
    }
  });

connectionsCommand
  .command("add")
  .description("Authorise a new bank")
  .option("-l, --label <label>", "Name for this connection")
  .action(async (options) => {
    const config = await loadConfig();
    const { promptForAuthCode } = await import("./truelayer");
    const { completeConnection } = await import("./connections");
    const code = await promptForAuthCode(config.truelayer);
    const { report } = await completeConnection(config, {
      code,
      ...(options.label ? { label: options.label } : {}),
    });
    printReconcile(report);
  });

connectionsCommand
  .command("reconnect")
  .description("Refresh the key for an existing connection, keeping its mappings")
  .argument("[connection]", "Connection id or label")
  .action(async (needle?: string) => {
    const config = await loadConfig();
    const { loadState } = await import("./state");
    const { promptForAuthCode } = await import("./truelayer");
    const { completeConnection } = await import("./connections");
    const state = loadState(config);

    let connectionId: string | undefined;
    if (needle) {
      connectionId = resolveConnection(state.connections, needle).id;
    } else if (state.connections.length === 1) {
      connectionId = state.connections[0]!.id;
    } else if (state.connections.length > 1) {
      const { picked } = await inquirer.prompt({
        type: "list",
        name: "picked",
        message: "Which connection do you want to reconnect?",
        choices: state.connections.map((c) => ({ name: c.label, value: c.id })),
      });
      connectionId = picked;
    }

    const code = await promptForAuthCode(config.truelayer);
    const { report } = await completeConnection(config, {
      code,
      ...(connectionId ? { connectionId } : {}),
    });
    printReconcile(report);
  });

connectionsCommand
  .command("refresh")
  .description("Re-fetch account lists from every bank and reconcile mappings")
  .action(async () => {
    const config = await loadConfig();
    const { refreshAllAccounts } = await import("./connections");
    for (const report of await refreshAllAccounts(config)) {
      printReconcile(report);
    }
  });

connectionsCommand
  .command("remove")
  .description("Delete a connection and its mappings")
  .argument("<connection>", "Connection id or label")
  .action(async (needle: string) => {
    const config = await loadConfig();
    const { loadState } = await import("./state");
    const { removeConnection } = await import("./connections");
    const target = resolveConnection(loadState(config).connections, needle);
    const { confirm } = await inquirer.prompt({
      type: "confirm",
      name: "confirm",
      message: `Remove "${target.label}" and its mappings? Transactions already in Actual are not touched.`,
    });
    if (!confirm) return;
    const { removedMappings } = await removeConnection(config, target.id);
    console.log(
      chalk.green(`Removed "${target.label}"${removedMappings ? ` and ${removedMappings} mapping(s)` : ""}.`),
    );
  });

// Mappings
const mapCommand = program
  .command("map")
  .description("Manage the mapping between bank accounts and Actual accounts");

mapCommand
  .command("list")
  .action(async () => {
    const config = await loadConfig();
    const { loadState } = await import("./state");
    const state = loadState(config);
    if (state.map.length === 0) {
      console.log(chalk.yellow("No mappings yet. Add one with: actual-sync map add"));
      return;
    }
    const actualNames = new Map(
      (state.actualAccountsCache?.accounts ?? []).map((a) => [a.id, a.name]),
    );
    for (const mapping of state.map) {
      const connection = state.connections.find((c) => c.id === mapping.connectionId);
      const bank = connection?.accounts.find((a) => a.id === mapping.truelayerAccountId);
      console.log(
        `\n${chalk.bold(mapping.name)}${mapping.enabled === false ? chalk.gray(" (disabled)") : ""}`,
      );
      console.log(
        `  ${connection?.label ?? chalk.red("unknown connection")} · ${bank?.name ?? chalk.red("unknown account")}` +
          `  →  ${actualNames.get(mapping.actualAccountId) ?? chalk.yellow("(name unknown — run connections refresh)")}`,
      );
      if (mapping.mapConfig?.invertAmount) console.log(chalk.gray("  amounts inverted"));
    }
  });

mapCommand
  .command("add")
  .description("Map a bank account to an Actual account, interactively")
  .action(async () => {
    const config = await loadConfig();
    const { loadState, updateState } = await import("./state");
    const { randomUUID } = await import("crypto");
    const state = loadState(config);

    const bankChoices = state.connections.flatMap((c) =>
      c.accounts.map((a) => ({
        name: `${c.label} · ${a.name}`,
        value: { connectionId: c.id, accountId: a.id, name: a.name, type: a.type },
      })),
    );
    if (bankChoices.length === 0) {
      console.error(chalk.red("No bank accounts available. Run: actual-sync connections add"));
      process.exit(1);
    }

    let actualAccounts = state.actualAccountsCache?.accounts ?? [];
    if (actualAccounts.length === 0) {
      console.log(chalk.gray("Fetching accounts from Actual..."));
      const { alignApiDependency } = await import("./align");
      await alignApiDependency(config);
      const { openActualSession } = await import("./actual");
      const session = await openActualSession(config.actual);
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
    }

    const answers = await inquirer.prompt([
      { type: "list", name: "bank", message: "Bank account", choices: bankChoices },
      {
        type: "list",
        name: "actualAccountId",
        message: "Actual account",
        choices: actualAccounts.map((a) => ({ name: a.name, value: a.id })),
      },
      { type: "input", name: "name", message: "Name for this mapping", default: (a: any) => a.bank.name },
      {
        type: "confirm",
        name: "invertAmount",
        message: "Invert amounts? (usually yes for credit cards)",
        default: (a: any) => a.bank.type === "CARD",
      },
    ]);

    await updateState(config, (fresh) => {
      fresh.map.push({
        id: randomUUID(),
        name: answers.name,
        connectionId: answers.bank.connectionId,
        truelayerAccountId: answers.bank.accountId,
        actualAccountId: answers.actualAccountId,
        mapConfig: { invertAmount: answers.invertAmount },
        enabled: true,
      });
    });
    console.log(chalk.green(`Added mapping "${answers.name}".`));
  });

mapCommand
  .command("remove")
  .argument("<name>", "Mapping name")
  .action(async (name: string) => {
    const config = await loadConfig();
    const { updateState } = await import("./state");
    const removed = await updateState(config, (fresh) => {
      const before = fresh.map.length;
      fresh.map = fresh.map.filter((m) => m.name.toLowerCase() !== name.toLowerCase());
      return before - fresh.map.length;
    });
    if (removed === 0) {
      console.error(chalk.red(`No mapping named "${name}".`));
      process.exit(1);
    }
    console.log(chalk.green(`Removed ${removed} mapping(s).`));
  });

// Truelayer
const truelayerCommand = program.command("truelayer");
truelayerCommand
  .command("add-account")
  .description("Deprecated — use: actual-sync connections add")
  .action(async () => {
    console.log(
      chalk.yellow(
        '"truelayer add-account" is now "actual-sync connections add", which stores the connection for you instead of printing YAML to copy.\n',
      ),
    );
    const config = await loadConfig();
    const { promptForAuthCode } = await import("./truelayer");
    const { completeConnection } = await import("./connections");
    const code = await promptForAuthCode(config.truelayer);
    const { report } = await completeConnection(config, { code });
    printReconcile(report);
  });

truelayerCommand.command("list-accounts").action(async () => {
  const config = await loadConfig();
  const { loadState } = await import("./state");
  const state = loadState(config);
  console.log(
    YAML.stringify(
      state.connections.flatMap((c) =>
        c.accounts.map((a) => ({ connection: c.label, id: a.id, name: a.name, type: a.type })),
      ),
      null,
      2,
    ),
  );
});

/** Find an account plus the connection that reaches it. */
const findBankAccount = async (accountId: string) => {
  const config = await loadConfig();
  const { loadState, findConnectionForAccount } = await import("./state");
  const state = loadState(config);
  const connection = findConnectionForAccount(state, accountId);
  const account = connection?.accounts.find((a) => a.id === accountId);
  if (!connection || !account) {
    console.error(
      chalk.red(
        "That account doesn't exist. Check the id and make sure its bank is connected first.",
      ),
    );
    process.exit(1);
  }
  return { config, connection, account };
};

truelayerCommand
  .command("list-transactions")
  .argument("accountId")
  .action(async (accountId) => {
    const { config, connection, account } = await findBankAccount(accountId);
    const { Truelayer } = await import("./truelayer");
    const { persistTokens } = await import("./connections");
    const truelayer = Truelayer(config.truelayer, {
      onTokens: (id, tokens) => persistTokens(config, id, tokens),
    });
    const transactions = await truelayer.getTransactions(account, connection);
    console.log(YAML.stringify(transactions, null, 2));
  });

truelayerCommand
  .command("get-balance")
  .argument("accountId")
  .action(async (accountId) => {
    const { config, connection, account } = await findBankAccount(accountId);
    const { Truelayer } = await import("./truelayer");
    const { persistTokens } = await import("./connections");
    const truelayer = Truelayer(config.truelayer, {
      onTokens: (id, tokens) => persistTokens(config, id, tokens),
    });
    const balance = await truelayer.getBalance(account, connection);
    console.log(JSON.stringify(balance, null, 2));
  });

program.command("sync").action(async () => {
  const commitHash = process.env.GIT_COMMIT_HASH || "unknown";
  console.log(chalk.bold.cyan(`\nStarting rr4444/actual-sync-minimal (commit: ${commitHash})`));
  const config = await loadConfig();
  const { alignApiDependency } = await import("./align");
  await alignApiDependency(config);

  try {
    const { Sync } = await import("./sync");
    await Sync(config).sync();
  } catch (error) {
    console.error(chalk.red("❌ Sync failed:"), error instanceof Error ? error.message : error);

    // Send error notification if ntfy is configured
    if (config.ntfy) {
      try {
        const { Ntfy } = await import("./ntfy");
        await Ntfy(config.ntfy).post({
          title: "Actual Sync - Error",
          body: `Sync failed with error:\n${error instanceof Error ? error.message : JSON.stringify(error)}`,
          tags: ["x", "bank", "error"],
          priority: "high",
        });
      } catch (notifyError) {
        console.error(
          chalk.red("Failed to send error notification:"),
          notifyError,
        );
      }
    }

    process.exit(1);
  }
});

program
  .command("server")
  .option("-p, --port <number>", "Port to run the server on", "8080")
  .action(async (options) => {
    const config = await loadConfig();
    const { startServer } = await import("./server");
    const port = parseInt(options.port, 10) || 8080;
    startServer(config, port);
  });

program.parse(process.argv);
