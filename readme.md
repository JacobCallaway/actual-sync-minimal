# Actual Sync (Minimal Fork) for UK and European Banks via TrueLayer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<img width="979" height="888" alt="image" src="https://github.com/user-attachments/assets/14513c27-6289-4187-be9f-acc70c360a01" />
<img width="872" height="515" alt="image" src="https://github.com/user-attachments/assets/2c6bfb3e-916d-4b6c-8e5d-c3fcc2dba1b8" />



> [!IMPORTANT]
> **IaC & Self-Alignment Architecture**
> This repository is a specialized fork of `andrewinci/actual-sync` designed to maximize **Infrastructure as Code (IaC) idempotency**, deployment maintainability, and container self-healing. 
> 
> In traditional containerized deployments, aligning a client API library with the server version requires host-side scripting, build-time overrides, or manual recompilations. This creates fragile, platform-dependent builds that violate declarative IaC principles.
> 
> To enforce absolute deployment idempotency, this fork shifts the version alignment from build-time to **runtime**. The container dynamically boots, self-inspects, and upgrades its `@actual-app/api` library to match the target Actual Budget server on the fly—driven declaratively by environment variables or configuration files. This results in:
> * **Zero Build Hacks:** No more `sed` regex patches or custom shell wrapper scripts in your deployment playbooks.
> * **Platform Agnosticism:** Standardized Docker builds that run identically on Kubernetes, bare metal, or raw Docker (once configuration data is created)
> * **Declarative Upgrades:** Upgrading your Actual server version setting automatically triggers a dynamic library alignment in the sync container upon its next scheduled run.

---

A minimal command-line tool that automatically syncs bank transactions from various financial providers directly into [Actual Budget](https://actualbudget.org/). 

Also see [rr4444/actual-ecommerce-noter](https://github.com/rr4444/actual-ecommerce-noter) for e-commerce purchase and refund processing for Amazon, Paypal and eBay, as well as AI auto-classification accounting for split transactions per product in a single order. 

## ✨ Features

- 🔄 **Automatic Transaction Sync** - Import transactions from supported banks
- 🏦 **Multi-Bank Support** - Connect multiple accounts from different providers
- 🖥️ **Web dashboard** - Connect banks and map accounts by name, no account IDs or CLI
- 🔑 **Graceful key expiry** - Consent warnings, per-bank failure isolation, and mappings that survive reconnecting
- 📊 **Flexible Account Mapping** - Configure how accounts sync to Actual Budget
- 🔔 **Notifications** - Optional ntfy integration for sync status notifications
- 🐋 **Docker Ready** - Easy deployment and containerization

## 🔄 Dynamic Runtime API Alignment

To ensure compatibility with your self-hosted [Actual Budget](https://actualbudget.org/) server without lagging behind or suffering from out-of-sync database migrations, this fork features an **automatic runtime self-updater**.

Instead of hardcoding a static version of `@actual-app/api` during image build time, the application programmatically aligns its dependencies **on the fly at startup** to match your server's API version. This guarantees the client remains perfectly up-to-date with your Actual server without requiring you to manually rebuild Docker images or patch package files.

### How it works
On startup, the application checks for a target version via two pathways:
1. **Environment Variable:** `ACTUAL_API_VERSION` (Recommended for containerized environments like Kubernetes).
2. **Configuration File:** `actual.apiVersion` property inside your `.config.yml` (Recommended for bare-metal or standard Docker).

If the currently installed library version in `node_modules` does not match the target version, the application programmatically downloads and installs the matching `@actual-app/api` version from the npm registry instantly (taking only ~3 seconds) before running the sync command.

### Configuration

#### Option A: Via Environment Variable (Docker/Kubernetes)
Pass the target version directly as an environment variable in your container specification:
```yaml
env:
  - name: ACTUAL_API_VERSION
    value: "26.4.0" # Match your Actual server version
```

#### Option B: Via Configuration File (`.config.yml`)
Add the `apiVersion` property under the `actual` section of your configuration file:
```yaml
actual:
  password: "your-actual-password"
  syncId: "your-sync-id"
  url: "https://your-actual-server.com"
  apiVersion: "26.4.0" # Match your Actual server version
```

## 🏦 Supported Providers

- **[TrueLayer](https://truelayer.com/)** - Connect to 300+ banks across UK and Europe
- **Trading 212** - _Coming soon_

## 📊 Dashboard

The dashboard is a small web app served by the `server` command. It manages
bank connections and account mapping, and shows the results of the last sync.

```bash
./actual-sync server --port 8080
```

### Tabs
* **Overview** — last sync at a glance: accounts synced, new transactions,
  balance mismatches and failures, plus per-account bank/ledger comparison.
  Connections that are expired or close to expiring are flagged at the top.
* **Connections** — one card per bank: status, consent time remaining, the
  accounts it covers, which of those are not yet mapped, and buttons to
  reconnect or remove.
* **Mappings** — the bank account → Actual account table. Both sides are chosen
  from dropdowns showing names, never ids. Toggle `invertAmount` (for credit
  cards) and enable/disable a mapping without deleting it. Changes are staged
  and written in one atomic save.

### Sync artefacts
Each sync also writes to `DASHBOARD_DATA_DIR`:
1. `sync-summary.json` — structured monitoring state, including a rolling
   history of the last 20 runs per account.
2. `index.html` — a static snapshot of the results, for serving from a plain
   web server when you would rather not run the app continuously.

### Kubernetes
The Helm chart deploys the dashboard as a Deployment plus Service, sharing a
PVC with the CronJob so both see the same connections and mapping. Its "Run
sync" button clones the CronJob into a one-off Job and streams the pod logs
back to the browser.

```bash
kubectl create secret generic actual-sync-dashboard \
  --from-literal=token="$(openssl rand -hex 32)"

helm upgrade --install actual-sync ./helm \
  --set dashboard.existingSecret=actual-sync-dashboard
```

Then open the dashboard as `https://your-host/?token=<the token>`.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ or Docker
- An [Actual Budget](https://actualbudget.org/) server instance
- Account with a supported financial provider (e.g., TrueLayer)

### Installation

#### Using pnpm (Recommended)

```bash
git clone https://github.com/andrewinci/actual-sync.git
cd actual-sync
pnpm install
pnpm run build
```

#### Using Docker

```bash
# Use pre-built image from GitHub Container Registry
docker pull ghcr.io/andrewinci/actual-sync:latest

# Or build locally
git clone https://github.com/andrewinci/actual-sync.git
cd actual-sync
docker build -t actual-sync .
```

## 📖 Usage

Bank connections and account mapping are managed from the web dashboard. The
config file only holds credentials; everything the app learns afterwards —
connections, tokens, and the account mapping — lives in `state.json` on the
data directory.

1. **Create a configuration file**:

   ```bash
   ./actual-sync config create
   ```

2. **Edit the generated `.config.yml`** with your credentials:

   ```yaml
   actual:
     password: "your-actual-password"
     syncId: "your-sync-id" # Found in Actual Settings > Advanced
     url: "https://your-actual-server.com" # or "localhost" for local
     cacheDir: ".cache/"

   truelayer:
     redirectUri: "https://console.truelayer.com/redirect-page"
     clientId: "your-truelayer-client-id"
     clientSecret: "your-truelayer-client-secret"
   ```

3. **Start the dashboard**:

   ```bash
   ./actual-sync server --port 8080
   ```

4. Open <http://localhost:8080>, then:
   - **Connections → Connect a bank** and follow your bank's consent screen.
   - **Mappings → Add mapping** and pick each bank account and the Actual
     account it feeds, choosing both by name.
   - **Run sync**.

### Prefer the terminal?

Every dashboard action has a CLI equivalent:

```bash
./actual-sync connections add        # authorise a bank
./actual-sync connections list       # show status and days of consent left
./actual-sync map add                # map an account, interactively
./actual-sync sync
```

## 🔑 Expiring keys and reconnecting

TrueLayer consent lasts about 90 days, after which a bank stops returning data
until you re-authorise. This fork handles that as a slope rather than a cliff:

- **Connections carry health.** Each one shows `active`, `expires in N days`,
  or `expired` in the dashboard and in `connections list`. ntfy notifications
  warn you in the week before consent lapses, while there is still time to
  reconnect without a failed sync.
- **One dead bank no longer stops the rest.** A sync isolates the failure per
  connection, syncs everything healthy, writes the dashboard, and *then*
  reports what failed with a non-zero exit code.
- **Mappings survive reconnecting.** Banks often issue new account ids when you
  re-consent. On reconnect the new account list is reconciled against the old
  one — by id, then by name and type — and mappings are rewritten to follow.
  The dashboard reports every id change, anything the consent no longer covers,
  and anything not yet mapped, so nothing changes silently.
- **Tokens are cached and rotations are kept.** An access token is fetched once
  per connection per run instead of once per API call, and a rotated refresh
  token is written to disk before it is used, so a crash mid-sync cannot strand
  a connection.

To reconnect: **Connections → Reconnect** in the dashboard, or

```bash
./actual-sync connections reconnect
```

### One-click reconnect (optional)

By default you paste the code from TrueLayer's redirect page into the
dashboard. To skip that step, point `truelayer.redirectUri` at the dashboard's
own callback and register the same URL in the TrueLayer console:

```yaml
truelayer:
  redirectUri: "https://actual-sync.example.com/api/truelayer/callback"
```

The dashboard detects this and completes the redirect itself.

## 📋 Command Reference

| Command                                   | Description                                       |
| ----------------------------------------- | ------------------------------------------------- |
| `config create`                           | Create a default configuration file               |
| `server [--port <n>]`                     | Start the dashboard                               |
| `sync`                                    | Synchronize all enabled mappings                  |
| `connections list`                        | Show each bank, its status and consent time left  |
| `connections add [--label <name>]`        | Authorise a new bank                              |
| `connections reconnect [connection]`      | Refresh a bank's key, keeping its mappings        |
| `connections refresh`                     | Re-fetch account lists and reconcile mappings     |
| `connections remove <connection>`         | Delete a connection and its mappings              |
| `map list`                                | Show the mapping, by name                         |
| `map add`                                 | Map a bank account to an Actual account           |
| `map remove <name>`                       | Delete a mapping                                  |
| `actual list-accounts`                    | List all Actual Budget accounts                   |
| `truelayer list-accounts`                 | List known bank accounts                          |
| `truelayer list-transactions <accountId>` | View transactions for a specific account          |
| `truelayer get-balance <accountId>`       | Check balance for a specific account              |

`truelayer add-account` still works but is an alias for `connections add`.

## 📄 Configuration File Reference

The config file holds credentials only, and can be mounted read-only.

```yaml
actual:
  password: "your-actual-password"
  syncId: "your-sync-id" # Found in Actual Settings > Advanced
  url: "https://your-actual-server.com" # or "localhost" for local
  cacheDir: ".cache/"
truelayer:
  # Leave as-is to paste the code into the dashboard, or point this at
  # <dashboard-url>/api/truelayer/callback for one-click reconnects.
  redirectUri: "https://console.truelayer.com/redirect-page"
  # you need a truelayer live app to get the below clientId and secret
  clientId: "your-truelayer-client-id"
  clientSecret: "your-truelayer-client-secret"
# Optional: Get notifications via ntfy (https://ntfy.sh)
ntfy:
  url: "https://ntfy.sh" # or your self-hosted ntfy server
  topic: "your-topic-name" # choose a unique topic name
```

### State file

Connections, refresh tokens, cached account lists and the account mapping are
stored in `state.json` under `STATE_DIR` (falling back to `DASHBOARD_DATA_DIR`,
then `/app/data` in the container image, or `.data/` when run from a checkout).
Back it up and keep it private — it holds bank refresh tokens. Writes are
atomic, so an interrupted run cannot corrupt it.

Existing installs need no migration: the first command you run imports
`truelayer.accounts` and `sync.map` out of the config into `state.json`,
grouping accounts that share a refresh token into one connection. The old keys
in the config are then ignored and can be deleted.

### Environment variables

| Variable                  | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `CONFIG_FILE_PATH`        | Config file location (default `.config.yml`)                  |
| `STATE_DIR`               | Where `state.json` is written                                 |
| `DASHBOARD_DATA_DIR`      | Where the sync summary is written; fallback for `STATE_DIR`   |
| `DASHBOARD_TOKEN`         | If set, the dashboard requires it — open `…/?token=<value>`   |
| `ACTUAL_API_VERSION`      | Pin the `@actual-app/api` version to align to                 |
| `ACTUAL_SYNC_CRONJOB_NAME`| CronJob the dashboard clones for a manual run (Kubernetes)    |

> **Security:** the dashboard can start bank authorisations and change where
> transactions land. It has no authentication unless you set `DASHBOARD_TOKEN`.
> Set one before exposing it beyond localhost.

## 🔔 Notifications

Actual-sync supports optional notifications via [ntfy](https://ntfy.sh) to keep you informed about sync status.

### Configuration

Add the `ntfy` section to your `.config.yml`:

```yaml
ntfy:
  url: "https://ntfy.sh" # or your self-hosted ntfy server URL
  topic: "your-unique-topic-name" # choose a topic name
```

## 🚀 Deployment

### ☸️ Kubernetes with Helm

The easiest way to deploy actual-sync to Kubernetes is using the included Helm chart. The deployment creates a CronJob that automatically syncs your bank transactions every 4 hours.

#### Prerequisites

- Kubernetes cluster
- Helm 3.x installed
- A `.config.yml` file with your credentials

#### Installation

1. **Deploy using your local configuration file:**

   ```bash
   # Create namespace and install with your config
   helm upgrade --install actual-sync ./helm \
     --set config.create=true \
     --set-file config.data=.config.yml \
     -n actual-sync --create-namespace
   ```

2. **Or use an existing ConfigMap:**
   ```bash
   # If you already have a ConfigMap named 'my-config'
   helm upgrade --install actual-sync ./helm \
     --set existingConfigMap=my-config \
     -n actual-sync --create-namespace
   ```

## 🔧 Development

### Setup

```bash
git clone https://github.com/andrewinci/actual-sync.git
cd actual-sync
pnpm install
```

### Available Scripts

- `pnpm run dev` - Run in development mode with ts-node
- `pnpm run build` - Build the application
- `pnpm run pretty` - Format code with Prettier

## 🐳 Docker

Docker images are automatically built and published to GitHub Container Registry on every release.

### Pre-built Images

```bash
# Pull the latest image
docker pull ghcr.io/andrewinci/actual-sync:latest

# Pull a specific version
docker pull ghcr.io/andrewinci/actual-sync:v1.0.0
```

### Build Locally

```bash
docker build -t actual-sync .
```

### Run

```bash
# Use pre-built image from GitHub Container Registry
docker run -e CONFIG_FILE_PATH=/config/.config.yml \
  -v ${PWD}/:/config/ \
  ghcr.io/andrewinci/actual-sync:latest [command]

# Examples:
# List accounts
docker run -e CONFIG_FILE_PATH=/config/.config.yml \
  -v ${PWD}/:/config/ \
  ghcr.io/andrewinci/actual-sync:latest actual list-accounts

# Run sync
docker run -e CONFIG_FILE_PATH=/config/.config.yml \
  -v ${PWD}/:/config/ \
  ghcr.io/andrewinci/actual-sync:latest sync
```

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This project is not officially associated with Actual Budget, TrueLayer, or any other financial institutions. Use at your own risk and always verify your financial data. The developers are not responsible for any financial discrepancies or data loss.
