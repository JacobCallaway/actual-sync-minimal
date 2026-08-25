import chalk from "chalk";
import { openActualSession, ActualTransaction } from "./actual";
import { AppConfig } from "./config";
import {
  Truelayer,
  TruelayerConnectionExpiredError,
  TruelayerTransaction,
} from "./truelayer";
import { daysUntilExpiry, deriveStatus, loadState, updateState } from "./state";
import { applyConsent, persistTokens } from "./connections";
import * as YAML from "yaml";
import { Ntfy } from "./ntfy";
import * as fs from "fs";
import * as path from "path";

export type SyncConfig = {
  map: {
    name: string;
    truelayerAccountId: string;
    actualAccountId: string;
    mapConfig: { invertAmount?: boolean };
  }[];
};

export const generateHtmlDashboard = (data: any): string => {
  const commitHash = process.env.GIT_COMMIT_HASH || "unknown";
  const repoLinkText = commitHash !== "unknown" ? `actual-sync-minimal (${commitHash})` : "actual-sync-minimal";
  const repoLinkUrl = commitHash !== "unknown" ? `https://github.com/rr4444/actual-sync-minimal/commit/${commitHash}` : "https://github.com/rr4444/actual-sync-minimal";

  const accountsHtml = data.accounts.map((acc: any, index: number) => {
    const matchStatus = acc.balances.match
      ? `<span class="badge badge-success">Match</span>`
      : `<span class="badge badge-warning">Mismatch</span>`;
      
    const balanceDiff = Math.abs(acc.balances.online - acc.balances.actual);
    const diffText = acc.balances.match
      ? ""
      : `<div class="diff-amount">Difference: ${acc.balances.currency} ${balanceDiff.toFixed(2)}</div>`;

    return `
      <div class="card account-card" onclick="showTransactions(${index})">
        <div class="account-header">
          <h3 class="account-name">${acc.name}</h3>
          ${matchStatus}
        </div>
        <div class="account-body">
          <div class="stat-row">
            <span class="stat-label">Online Balance:</span>
            <span class="stat-value val-online">${acc.balances.currency} ${acc.balances.online?.toFixed(2) ?? "0.00"}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Actual Balance:</span>
            <span class="stat-value val-actual">${acc.balances.currency} ${acc.balances.actual?.toFixed(2) ?? "0.00"}</span>
          </div>
          ${diffText}
          <div class="divider"></div>
          <div class="sync-details">
            <div class="detail-item">
              <span class="detail-label">Added</span>
              <span class="detail-val val-added">${acc.added}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Updated</span>
              <span class="detail-val val-updated">${acc.updated}</span>
            </div>
            <div class="detail-item" title="Incoming transactions that matched one already in Actual. A high number here is normal — it is deduplication working, not a backlog.">
              <span class="detail-label">Matched</span>
              <span class="detail-val val-zero">${acc.updatedPreview}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Errors</span>
              <span class="detail-val ${acc.errors > 0 ? "val-error" : "val-zero"}">${acc.errors}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("\n");

  const overallStatus = data.overall.balanceMismatches > 0
    ? `<span class="badge badge-warning">Attention Needed</span>`
    : `<span class="badge badge-success">All Synced & Matching</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Actual Sync Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    :root {
      --bg-color: #080c14;
      --card-bg: rgba(17, 24, 39, 0.6);
      --card-border: rgba(255, 255, 255, 0.08);
      --text-primary: #f3f4f6;
      --text-secondary: #9ca3af;
      --text-muted: #6b7280;
      --accent-primary: #3b82f6;
      --accent-success: #10b981;
      --accent-warning: #f59e0b;
      --accent-error: #ef4444;
      --glow-color: rgba(59, 130, 246, 0.15);
    }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg-color);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
      background-image: 
        radial-gradient(circle at 10% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 90% 80%, rgba(16, 185, 129, 0.05) 0%, transparent 40%);
    }
    .container {
      width: 100%;
      max-width: 1200px;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem 2rem;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
    }
    h1 {
      font-family: 'Outfit', sans-serif;
      font-weight: 800;
      font-size: 1.75rem;
      background: linear-gradient(135deg, #f3f4f6 30%, #9ca3af 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.02em;
    }
    .subtitle {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-top: 0.25rem;
    }
    .header-right {
      text-align: right;
    }
    .last-sync {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .badge-success {
      background-color: rgba(16, 185, 129, 0.12);
      color: var(--accent-success);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .badge-warning {
      background-color: rgba(245, 158, 11, 0.12);
      color: var(--accent-warning);
      border: 1px solid rgba(245, 158, 11, 0.2);
    }
    .overall-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.5rem;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.5rem;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px var(--glow-color);
    }
    .stat-card-title {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }
    .stat-card-value {
      font-family: 'Outfit', sans-serif;
      font-size: 2rem;
      font-weight: 700;
    }
    .stat-card-value.success {
      color: var(--accent-success);
    }
    .stat-card-value.warning {
      color: var(--accent-warning);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 1.5rem;
    }
    .account-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.75rem;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .account-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(255, 255, 255, 0.02);
    }
    .account-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .account-name {
      font-family: 'Outfit', sans-serif;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.95rem;
      margin-bottom: 0.75rem;
    }
    .stat-label {
      color: var(--text-secondary);
    }
    .stat-value {
      font-family: 'Outfit', sans-serif;
      font-weight: 600;
    }
    .val-online {
      color: var(--text-primary);
    }
    .val-actual {
      color: #93c5fd;
    }
    .diff-amount {
      font-size: 0.8rem;
      color: var(--accent-warning);
      text-align: right;
      margin-top: -0.5rem;
      font-weight: 500;
    }
    .divider {
      height: 1px;
      background-color: var(--card-border);
      width: 100%;
    }
    .sync-details {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      text-align: center;
      gap: 0.5rem;
    }
    .detail-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .detail-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .detail-val {
      font-family: 'Outfit', sans-serif;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .val-added {
      color: var(--accent-success);
    }
    .val-updated {
      color: var(--accent-primary);
    }
    .val-zero {
      color: var(--text-muted);
    }
    .val-error {
      color: var(--accent-error);
    }
    /* Clickable accounts styling */
    .account-card {
      cursor: pointer;
      position: relative;
    }
    .account-card::after {
      content: "Click to view recent transactions";
      position: absolute;
      bottom: 0.5rem;
      left: 50%;
      transform: translateX(-50%);
      font-size: 0.7rem;
      color: var(--text-muted);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .account-card:hover::after {
      opacity: 0.8;
    }
    /* Transaction Drawer Styles */
    .drawer-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      z-index: 999;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    .drawer-overlay.open {
      opacity: 1;
      pointer-events: auto;
    }
    .transaction-drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 100%;
      max-width: 500px;
      height: 100vh;
      background: rgba(8, 12, 20, 0.95);
      backdrop-filter: blur(25px);
      border-left: 1px solid var(--card-border);
      z-index: 1000;
      transform: translateX(100%);
      transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
    }
    .transaction-drawer.open {
      transform: translateX(0);
    }
    .drawer-header {
      padding: 1.5rem 2rem;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .drawer-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.25rem;
      font-weight: 700;
      background: linear-gradient(135deg, #f3f4f6 30%, #9ca3af 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .close-btn {
      background: transparent;
      border: 1px solid var(--card-border);
      color: var(--text-primary);
      font-size: 1.5rem;
      cursor: pointer;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }
    .close-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .drawer-content {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem 2rem;
    }
    .tx-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    .tx-table th, .tx-table td {
      padding: 0.75rem 0.5rem;
      text-align: left;
    }
    .tx-table th {
      border-bottom: 1px solid var(--card-border);
      color: var(--text-muted);
      font-weight: 500;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
    .tx-table tr {
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }
    .tx-date {
      color: var(--text-secondary);
      white-space: nowrap;
      font-family: 'Outfit', sans-serif;
    }
    .tx-payee {
      font-weight: 500;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .match-ok {
      color: var(--text-primary);
    }
    .match-mismatch {
      color: var(--accent-warning);
      font-weight: 600;
    }
    .tx-amount {
      text-align: right;
      font-family: 'Outfit', sans-serif;
      font-weight: 600;
    }
    .tx-credit {
      color: var(--accent-success);
    }
    .tx-updated {
      color: var(--accent-primary);
    }
    .tx-error {
      color: var(--accent-error);
      font-weight: 600;
    }
    .tx-zero {
      color: var(--text-muted);
    }
    .no-tx {
      text-align: center;
      color: var(--text-muted);
      padding: 2rem 0;
    }
    footer {
      text-align: center;
      margin-top: auto;
      padding-top: 3rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    footer a {
      color: var(--text-secondary);
      text-decoration: none;
    }
    footer a:hover {
      text-decoration: underline;
    }

    /* Button Styles */
    .btn {
      background: linear-gradient(135deg, #3b82f6, #1d4ed8);
      color: white;
      border: none;
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.875rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
      transition: all 0.2s ease;
    }
    .btn:hover:not(:disabled) {
      background: linear-gradient(135deg, #2563eb, #1e40af);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(59, 130, 246, 0.3);
    }
    .btn:active:not(:disabled) {
      transform: translateY(0);
    }
    .btn:disabled {
      background: #1f2937;
      color: #4b5563;
      border: 1px solid rgba(255, 255, 255, 0.05);
      cursor: not-allowed;
      box-shadow: none;
    }
    .btn-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: white;
      animation: spin 0.8s linear infinite;
      display: inline-block;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Terminal Console Styles */
    .terminal {
      margin-top: 2rem;
      background: #040507;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.8), 0 10px 30px rgba(0, 0, 0, 0.5);
      animation: slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .terminal-header {
      background: rgba(255, 255, 255, 0.02);
      padding: 0.75rem 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .terminal-title {
      font-family: monospace;
      font-size: 0.8rem;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .terminal-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--text-muted);
    }
    .terminal-dot.running {
      background-color: var(--accent-warning);
      box-shadow: 0 0 8px var(--accent-warning);
      animation: pulse 1s infinite alternate;
    }
    .terminal-dot.success {
      background-color: var(--accent-success);
      box-shadow: 0 0 8px var(--accent-success);
    }
    .terminal-dot.failed {
      background-color: var(--accent-error);
      box-shadow: 0 0 8px var(--accent-error);
    }
    @keyframes pulse {
      from { opacity: 0.4; }
      to { opacity: 1; }
    }
    .terminal-body {
      padding: 1.25rem;
      max-height: 350px;
      overflow-y: auto;
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.85rem;
      line-height: 1.5;
      color: #d1d5db;
    }
    .terminal-body pre {
      white-space: pre-wrap;
      word-break: break-all;
    }
    .log-info { color: #38bdf8; }
    .log-success { color: #10b981; }
    .log-warning { color: #f59e0b; }
    .log-error { color: #ef4444; font-weight: 600; }
    .log-process { color: #9ca3af; }
    .log-highlight {
      background: rgba(239, 68, 68, 0.1);
      border: 1px dashed rgba(239, 68, 68, 0.3);
      padding: 1rem;
      border-radius: 8px;
      margin-top: 1rem;
      color: #fca5a5;
      font-family: sans-serif;
      font-size: 0.9rem;
      line-height: 1.6;
      text-align: left;
    }
    .log-highlight strong {
      color: #ef4444;
      display: block;
      margin-bottom: 0.5rem;
    }
    .log-highlight ol {
      margin-left: 1.5rem;
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Actual Sync Dashboard</h1>
        <div class="subtitle">Real-time platform-agnostic runtime alignment monitoring</div>
      </div>
      <div class="header-right">
        <div style="display: flex; gap: 1.25rem; align-items: center; justify-content: flex-end;">
          <div style="text-align: right;">
            ${overallStatus}
            <div class="last-sync" id="last-sync-time" data-timestamp="${data.lastSyncTime}">Last updated: ${new Date(data.lastSyncTime).toUTCString()}</div>
          </div>
          <button id="run-sync-btn" class="btn btn-primary" onclick="triggerSyncRun()" disabled>
            <span class="btn-spinner" id="sync-spinner" style="display: none;"></span>
            <span id="sync-btn-text">Run Sync</span>
          </button>
        </div>
      </div>
    </header>

    <div class="overall-stats">
      <div class="stat-card">
        <div class="stat-card-title">Accounts Synced</div>
        <div class="stat-card-value">${data.overall.accountSyncs}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-title">New Transactions</div>
        <div class="stat-card-value success">${data.overall.newTransactions}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-title">Balance Mismatches</div>
        <div class="stat-card-value ${data.overall.balanceMismatches > 0 ? "warning" : ""}">${data.overall.balanceMismatches}</div>
      </div>
    </div>

    <div class="grid">
      ${accountsHtml}
    </div>
  </div>

  <div class="drawer-overlay" id="drawer-overlay" onclick="closeDrawer()"></div>
  <div class="transaction-drawer" id="transaction-drawer">
    <div class="drawer-header">
      <h2 class="drawer-title" id="drawer-title">Sync History</h2>
      <button class="close-btn" onclick="closeDrawer()">&times;</button>
    </div>
    <div class="drawer-content">
      <table class="tx-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Online / Actual</th>
            <th style="text-align: right;">Add</th>
            <th style="text-align: right;">Upd</th>
            <th style="text-align: right;" title="Matched an already-imported transaction">Mch</th>
            <th style="text-align: right;">Err</th>
          </tr>
        </thead>
        <tbody id="drawer-table-body">
          <!-- Dynamic sync history rows inserted here -->
        </tbody>
      </table>
    </div>
  </div>

    <!-- Logs Terminal -->
    <div class="terminal" id="sync-terminal" style="display: none; width: 100%;">
      <div class="terminal-header">
        <div class="terminal-title">
          <div class="terminal-dot" id="sync-terminal-dot"></div>
          <span>Sync Log Output</span>
        </div>
      </div>
      <div class="terminal-body">
        <pre id="sync-log-content"></pre>
      </div>
    </div>

  <footer>
    <a href="${repoLinkUrl}" target="_blank">${repoLinkText}</a> &bull; <a href="/actual-sync-minimal/sync-summary.json" target="_blank">View raw JSON</a>
  </footer>

  <script>
    const accountsData = ${JSON.stringify(data.accounts)};
    
    // Format last updated time in client's local timezone
    const lastSyncEl = document.getElementById('last-sync-time');
    if (lastSyncEl) {
      const timestamp = lastSyncEl.getAttribute('data-timestamp');
      if (timestamp) {
        const date = new Date(timestamp);
        try {
          const formatted = date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
          });
          lastSyncEl.innerText = 'Last updated: ' + formatted;
        } catch (e) {
          lastSyncEl.innerText = 'Last updated: ' + date.toLocaleString();
        }
      }
    }
    
    function showTransactions(accountIndex) {
      const account = accountsData[accountIndex];
      if (!account) return;
      
      const drawer = document.getElementById('transaction-drawer');
      const drawerTitle = document.getElementById('drawer-title');
      const tableBody = document.getElementById('drawer-table-body');
      
      drawerTitle.innerText = account.name + ' - Sync History';
      
      if (!account.history || account.history.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="no-tx">No sync history recorded yet.</td></tr>';
      } else {
        tableBody.innerHTML = account.history.map(run => {
          const matchClass = run.balances.match ? 'match-ok' : 'match-mismatch';
          const date = new Date(run.timestamp);
          const dateStr = date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) + ' ' + 
                          date.toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit', timeZoneName: 'short'});
          return \`
            <tr>
              <td class="tx-date">\${dateStr}</td>
              <td class="tx-payee \${matchClass}">
                \${account.balances.currency} \${run.balances.online.toFixed(2)} / 
                \${account.balances.currency} \${run.balances.actual.toFixed(2)}
              </td>
              <td class="tx-amount tx-credit">\${run.added}</td>
              <td class="tx-amount tx-updated">\${run.updated}</td>
              <td class="tx-amount tx-zero" title="Transactions matched to ones already imported">\${run.updatedPreview}</td>
              <td class="tx-amount \${run.errors > 0 ? 'tx-error' : 'tx-zero'}">\${run.errors}</td>
            </tr>
          \`;
        }).join('');
      }
      
      drawer.classList.add('open');
      document.getElementById('drawer-overlay').classList.add('open');
    }

    function closeDrawer() {
      document.getElementById('transaction-drawer').classList.remove('open');
      document.getElementById('drawer-overlay').classList.remove('open');
    }

    // Keyboard support (Escape key to close drawer)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDrawer();
      }
    });

    // Resolve basePath: handle Traefik subpath prefix if present
    let basePath = window.location.pathname;
    if (basePath.endsWith('index.html')) {
      basePath = basePath.substring(0, basePath.length - 'index.html'.length);
    }
    if (!basePath.endsWith('/')) {
      basePath += '/';
    }

    const runSyncBtn = document.getElementById('run-sync-btn');
    const syncSpinner = document.getElementById('sync-spinner');
    const syncBtnText = document.getElementById('sync-btn-text');
    const syncTerminal = document.getElementById('sync-terminal');
    const syncTerminalDot = document.getElementById('sync-terminal-dot');
    const syncLogContent = document.getElementById('sync-log-content');

    async function checkSyncStatus() {
      try {
        const response = await fetch(basePath + 'api/status');
        const data = await response.json();
        if (data.enabled) {
          runSyncBtn.disabled = false;
        } else {
          runSyncBtn.disabled = true;
          console.warn("Sync trigger disabled:", data.error || "Backend status check failed");
        }
      } catch (error) {
        runSyncBtn.disabled = true;
        console.error("Failed to check sync status:", error);
      }
    }

    async function triggerSyncRun() {
      runSyncBtn.disabled = true;
      syncSpinner.style.display = 'inline-block';
      syncBtnText.textContent = 'Running...';
      
      syncTerminal.style.display = 'block';
      syncLogContent.textContent = 'Initializing sync request...\\n';
      syncTerminalDot.className = 'terminal-dot running';
      syncTerminal.scrollIntoView({ behavior: 'smooth' });

      try {
        const response = await fetch(basePath + 'api/run', { method: 'POST' });
        const data = await response.json();
        
        if (data.success && data.job_id) {
          syncLogContent.textContent += 'Successfully spawned sync job (' + data.mode + ' Mode): ' + data.job_id + '\\nStreaming logs...\\n----------------------------------------------------------\\n';
          pollLogs(data.job_id);
        } else {
          syncLogContent.textContent += 'Error triggering sync: ' + (data.error || 'Unknown error') + '\\n';
          syncTerminalDot.className = 'terminal-dot failed';
          resetSyncBtn();
        }
      } catch (error) {
        syncLogContent.textContent += 'Failed to connect to trigger API: ' + error.message + '\\n';
        syncTerminalDot.className = 'terminal-dot failed';
        resetSyncBtn();
      }
    }

    function resetSyncBtn() {
      runSyncBtn.disabled = false;
      syncSpinner.style.display = 'none';
      syncBtnText.textContent = 'Run Sync';
    }

    function colorizeLogs(text) {
      if (!text) return '';
      let escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Colorize process markers and status
      escaped = escaped
        .replace(/(Starting rr4444\\/actual-sync-minimal.*)/gi, '<span class="log-info">\$1</span>')
        .replace(/(Sync transactions for.*)/gi, '<span class="log-info"><strong>\$1</strong></span>')
        .replace(/(Sync result|Sync completed|Successfully aligned)/gi, '<span class="log-success">\$1</span>')
        .replace(/(⚠️.*|Warning:.*|Update available.*|out-of-sync-migrations)/gi, '<span class="log-warning">\$1</span>')
        .replace(/(❌.*|Failed.*|Error.*)/gi, '<span class="log-error">\$1</span>')
        .replace(/(pnpm add @actual-app\\/api.*|npm install.*|Running command:.*)/gi, '<span class="log-process">\$1</span>');

      // Check if out-of-sync-migrations is present and inject troubleshooting warning
      if (text.indexOf('out-of-sync-migrations') !== -1 || text.indexOf('out_of_sync_migrations') !== -1) {
        escaped += '\\n<div class="log-highlight">' +
          '<strong>⚠️ DATABASE MIGRATION MISMATCH DETECTED!</strong>' +
          'Your Actual Budget database has migrations introduced in a newer version of Actual Budget Server than the local @actual-app/api target version.<br><br>' +
          'To fix this, check your Ansible variables and align versions:<br>' +
          '<ol>' +
          '<li>Verify your Ansible variable <code>actual_server_version</code> is correct (currently configured as <code>"26.6.0"</code>).</li>' +
          '<li>Update the <code>ACTUAL_API_VERSION</code> environment variable in your Kubernetes base manifests (e.g. <code>actual-sync-cronjob.yaml</code> and the dashboard deployment) to match your server version (e.g. <code>"26.6.0"</code>).</li>' +
          '<li>Re-deploy to let the container automatically align to the matching Actual API version.</li>' +
          '</ol>' +
          '</div>';
      }
      return escaped;
    }

    function pollLogs(jobId) {
      const interval = setInterval(async () => {
        try {
          const response = await fetch(basePath + 'api/logs/' + jobId);
          if (!response.ok) {
            throw new Error('HTTP status ' + response.status);
          }
          const data = await response.json();
          
          if (data.logs) {
            const bodyEl = syncTerminal.querySelector('.terminal-body');
            syncLogContent.innerHTML = colorizeLogs(data.logs);
            bodyEl.scrollTop = bodyEl.scrollHeight;
          }
          
          if (data.status === 'success') {
            clearInterval(interval);
            syncTerminalDot.className = 'terminal-dot success';
            resetSyncBtn();
            setTimeout(() => window.location.reload(), 2000);
          } else if (data.status === 'failed') {
            clearInterval(interval);
            syncTerminalDot.className = 'terminal-dot failed';
            resetSyncBtn();
          }
        } catch (error) {
          clearInterval(interval);
          syncLogContent.innerHTML += '\\n<span class="log-error">Error fetching logs: ' + error.message + '</span>';
          syncTerminalDot.className = 'terminal-dot failed';
          resetSyncBtn();
        }
      }, 1500);
    }

    // Run status check on load
    checkSyncStatus();
  </script>
</body>
</html>`;
};

export const Sync = (config: AppConfig) => {
  const mapTx = (
    tx: TruelayerTransaction,
    accountId: string,
    mapConfig: { invertAmount?: boolean },
  ): ActualTransaction => {
    const date = new Date(tx.timestamp);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");

    return {
      account: accountId,
      date: `${yyyy}-${mm}-${dd}`,
      amount: (mapConfig.invertAmount ? -1 : +1) * Math.round(tx.amount * 100),
      notes: tx.description,
      imported_id: tx.transaction_id,
      payee_name:
        tx.meta.provider_merchant_name ??
        tx.meta.counter_party_preferred_name ??
        tx.description,
      // Only settled transactions count as cleared. Providers that report no
      // status at all are treated as settled, matching the old behaviour.
      cleared: tx.transaction_status ? tx.transaction_status === "SETTLED" : true,
    };
  };

  const sync = async () => {
    const state = loadState(config);
    const truelayer = Truelayer(config.truelayer, {
      onTokens: (id, tokens) => persistTokens(config, id, tokens),
    });

    let fingerprint: string | undefined;
    const actual = await openActualSession(config.actual, {
      ...(state.actualCacheFingerprint
        ? { previousFingerprint: state.actualCacheFingerprint }
        : {}),
      onFingerprint: (fp) => {
        fingerprint = fp;
      },
    });

    try {
      const actualAccounts = await actual.listAccounts();
      const syncResult = {
        accountSyncs: 0,
        newTransactions: 0,
        balanceMismatches: 0,
        mismatchedBanks: [] as string[],
      };
      /** Connections whose key died mid-run. Collected rather than thrown so a
       * single expired bank cannot stop the healthy ones from syncing. */
      const expiredConnections = new Map<string, string>();
      /** Consent metadata, fetched once per connection per run so the expiry
       * countdown stays honest without anyone opening the dashboard. */
      const consents = new Map<string, Awaited<ReturnType<typeof truelayer.getConsent>>>();
      const failures: { name: string; reason: string }[] = [];

      const dashboardDir = process.env.DASHBOARD_DATA_DIR || "/app/data";
      let existingDashboardData: any = null;
      try {
        const jsonPath = path.join(dashboardDir, "sync-summary.json");
        if (fs.existsSync(jsonPath)) {
          existingDashboardData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        }
      } catch (e) {
        // ignore errors
      }

      const dashboardData = {
        lastSyncTime: new Date().toISOString(),
        commitHash: process.env.GIT_COMMIT_HASH || "unknown",
        overall: {
          accountSyncs: 0,
          newTransactions: 0,
          balanceMismatches: 0,
          mismatchedBanks: [] as string[],
          failures: [] as { name: string; reason: string }[],
        },
        connections: [] as any[],
        accounts: [] as any[],
      };

      const enabled = state.map.filter((m) => m.enabled !== false);
      if (enabled.length === 0) {
        console.log(
          chalk.yellow(
            "No account mappings are configured. Add them in the dashboard, or run: actual-sync map add",
          ),
        );
      }

      for (const mapping of enabled) {
        console.log(
          chalk.bold.bgYellow(`\nSync transactions for ${mapping.name}`),
        );

        const connection = state.connections.find(
          (c) => c.id === mapping.connectionId,
        );

        // Skip a bank we already know is dead rather than burning a failing
        // token exchange for every one of its accounts.
        if (connection && expiredConnections.has(connection.id)) {
          console.log(
            chalk.yellow(
              `Skipped — the connection for "${connection.label}" has expired.`,
            ),
          );
          failures.push({
            name: mapping.name,
            reason: `Connection "${connection.label}" has expired`,
          });
          continue;
        }

        try {
          const actualAccount = actualAccounts.find(
            (a) => a.id === mapping.actualAccountId,
          );
          const truelayerAccount = connection?.accounts.find(
            (a) => a.id === mapping.truelayerAccountId,
          );
          if (!connection)
            throw new Error(
              `No bank connection found for "${mapping.name}". Reconnect it from the dashboard.`,
            );
          if (!actualAccount)
            throw new Error(
              `Actual account ${mapping.actualAccountId} not found for "${mapping.name}". Re-pick it in the dashboard.`,
            );
          if (!truelayerAccount)
            throw new Error(
              `Bank account ${mapping.truelayerAccountId} is not covered by the connection for "${mapping.name}". Reconnect it from the dashboard.`,
            );

          if (!consents.has(connection.id)) {
            consents.set(
              connection.id,
              await truelayer.getConsent(connection).catch(() => null),
            );
          }

          const truelayerTransactions = await truelayer.getTransactions(
            truelayerAccount,
            connection,
          );
          const actualTransactions = truelayerTransactions.map((t) =>
            mapTx(t, mapping.actualAccountId, mapping.mapConfig ?? {}),
          );
          const report = await actual.loadTransactions(
            mapping.actualAccountId,
            actualTransactions,
          );
          console.log(chalk.green("Sync result"));
          console.log(YAML.stringify(report, null, 2));

          // verify balances
          const truelayerBalance = await truelayer.getBalance(
            truelayerAccount,
            connection,
          );
          const actualBalance = await actual.getBalance(actualAccount.id);
          const sign = truelayerAccount.type === "CARD" ? -1 : 1;
          syncResult.newTransactions += report.added;

          const isMatch =
            truelayerBalance?.current === (actualBalance / 100) * sign;

          const existingAcc = existingDashboardData?.accounts?.find(
            (a: any) => a.actualAccountId === mapping.actualAccountId,
          );
          const existingHistory = existingAcc?.history || [];

          const currentHistoryEntry = {
            timestamp: new Date().toISOString(),
            added: report.added,
            updated: report.updated,
            updatedPreview: report.updatedPreview,
            errors: report.errors,
            balances: {
              online: truelayerBalance?.current ?? 0,
              actual: (actualBalance / 100) * sign,
              match: isMatch,
            },
          };

          const accountHistory = [currentHistoryEntry, ...existingHistory].slice(
            0,
            20,
          );

          dashboardData.accounts.push({
            name: mapping.name,
            connectionId: mapping.connectionId,
            truelayerAccountId: mapping.truelayerAccountId,
            actualAccountId: mapping.actualAccountId,
            added: report.added,
            updated: report.updated,
            errors: report.errors,
            updatedPreview: report.updatedPreview,
            balances: {
              online: truelayerBalance?.current ?? 0,
              actual: (actualBalance / 100) * sign,
              match: isMatch,
              currency: truelayerBalance?.currency || "GBP",
            },
            history: accountHistory,
          });

          if (isMatch) console.log(chalk.green(`Account balances match`));
          else {
            syncResult.balanceMismatches += 1;
            syncResult.mismatchedBanks.push(mapping.name);
            console.log(chalk.red(`Account balances DO NOT match`));
            console.log(chalk.green("\nOnline balance"));
            console.log(YAML.stringify(truelayerBalance, null, 2));
            console.log(chalk.green("\nActual balance"));
            console.log(actualBalance / 100);
          }
          syncResult.accountSyncs += 1;
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : String(error);
          if (error instanceof TruelayerConnectionExpiredError && connection) {
            expiredConnections.set(connection.id, reason);
            console.error(
              chalk.red(
                `Connection for "${connection.label}" has expired — reconnect it from the dashboard. Continuing with the other accounts.`,
              ),
            );
          } else {
            console.error(chalk.red(`Failed to sync "${mapping.name}": ${reason}`));
          }
          failures.push({ name: mapping.name, reason });
        }
      }

      // Persist everything the run learned: dead connections, and which budget
      // the local cache now holds.
      await updateState(config, (fresh) => {
        for (const [id, reason] of expiredConnections) {
          const connection = fresh.connections.find((c) => c.id === id);
          if (connection) {
            connection.status = "expired";
            connection.lastRefreshError = reason;
          }
        }
        for (const [id, consent] of consents) {
          const connection = fresh.connections.find((c) => c.id === id);
          if (connection) applyConsent(connection, consent ?? null);
        }
        if (fingerprint) fresh.actualCacheFingerprint = fingerprint;
        fresh.actualAccountsCache = {
          accounts: actualAccounts,
          fetchedAt: new Date().toISOString(),
          syncId: config.actual.syncId,
        };
      });

      const latest = loadState(config);
      dashboardData.connections = latest.connections.map((c) => ({
        id: c.id,
        label: c.label,
        status: deriveStatus(c),
        daysUntilExpiry: daysUntilExpiry(c),
        lastRefreshAt: c.lastRefreshAt ?? null,
        lastRefreshError: c.lastRefreshError ?? null,
        accountCount: c.accounts.length,
      }));

      dashboardData.overall = {
        accountSyncs: syncResult.accountSyncs,
        newTransactions: syncResult.newTransactions,
        balanceMismatches: syncResult.balanceMismatches,
        mismatchedBanks: syncResult.mismatchedBanks,
        failures,
      };

      // Write dashboard outputs to disk
      try {
        if (!fs.existsSync(dashboardDir)) {
          fs.mkdirSync(dashboardDir, { recursive: true });
        }

        const jsonPath = path.join(dashboardDir, "sync-summary.json");
        fs.writeFileSync(jsonPath, JSON.stringify(dashboardData, null, 2), "utf8");
        console.log(chalk.green(`\n📊 Raw dashboard JSON written to ${jsonPath}`));

        const htmlPath = path.join(dashboardDir, "index.html");
        fs.writeFileSync(htmlPath, generateHtmlDashboard(dashboardData), "utf8");
        console.log(chalk.green(`🖥️  Dashboard written to ${htmlPath}`));
      } catch (err) {
        console.error(chalk.red("\n❌ Failed to write dashboard summary files:"), err);
      }

      // Connections that still work but are close to lapsing — warn while
      // there is still time to reconnect without a failed sync.
      const expiringSoon = latest.connections.filter(
        (c) => deriveStatus(c) === "expiring",
      );

      if (config.ntfy) {
        console.log(chalk.blue("\n📱 Sending notification..."));
        const hasIssues =
          syncResult.balanceMismatches > 0 ||
          failures.length > 0 ||
          expiredConnections.size > 0;
        const title = hasIssues
          ? "Actual Sync - Issues Detected"
          : "Actual Sync Completed";
        const tags = hasIssues
          ? ["warning", "bank"]
          : ["white_check_mark", "bank"];

        const body = [
          `Sync Summary`,
          `- Accounts synced: ${syncResult.accountSyncs}`,
          `- New transactions: ${syncResult.newTransactions}`,
          `- Balance mismatches: ${syncResult.balanceMismatches}`,
          ...(failures.length
            ? ["", `Failed: ${failures.map((f) => f.name).join(", ")}`]
            : []),
          ...(expiredConnections.size
            ? [
                "",
                `Expired connections need reconnecting: ${[...expiredConnections.keys()]
                  .map(
                    (id) =>
                      latest.connections.find((c) => c.id === id)?.label ?? id,
                  )
                  .join(", ")}`,
              ]
            : []),
          ...(expiringSoon.length
            ? [
                "",
                ...expiringSoon.map(
                  (c) =>
                    `Consent for ${c.label} expires in ${daysUntilExpiry(c)} days — reconnect it from the dashboard.`,
                ),
              ]
            : []),
          ...(syncResult.balanceMismatches > 0
            ? ["", `Balance mismatches detected in: ${syncResult.mismatchedBanks.join(", ")}`]
            : []),
          ...(!hasIssues
            ? ["", "All accounts synced successfully with matching balances!"]
            : []),
        ].join("\n");

        try {
          await Ntfy(config.ntfy).post({
            title,
            body,
            tags,
            priority: hasIssues ? "high" : "default",
          });
        } catch (error) {
          console.error(chalk.red("Failed to send notification:"), error);
        }
      }

      for (const connection of expiringSoon) {
        console.log(
          chalk.yellow(
            `⚠️  Consent for "${connection.label}" expires in ${daysUntilExpiry(connection)} days — reconnect it from the dashboard.`,
          ),
        );
      }

      // Everything above is durable before we surface the failure, so a
      // partial run still leaves a usable dashboard and up-to-date state.
      if (failures.length > 0) {
        throw new Error(
          `${failures.length} of ${enabled.length} account(s) failed to sync:\n` +
            failures.map((f) => `  - ${f.name}: ${f.reason}`).join("\n"),
        );
      }
    } finally {
      await actual.shutdown();
    }
  };

  return { sync };
};
