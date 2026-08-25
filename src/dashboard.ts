/** The interactive dashboard served by `actual-sync server`.
 *
 * Plain HTML + vanilla JS in a template string, matching the approach already
 * used by `generateHtmlDashboard` in sync.ts, so the esbuild single-file bundle
 * and the Dockerfile need no extra tooling. Design tokens are shared with that
 * dashboard so the two look like one product. */

const STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
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
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    background-color: var(--bg-color);
    color: var(--text-primary);
    min-height: 100vh;
    padding: 2rem 1rem;
    background-image:
      radial-gradient(circle at 10% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 40%),
      radial-gradient(circle at 90% 80%, rgba(16, 185, 129, 0.05) 0%, transparent 40%);
  }
  .container { width: 100%; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
  header {
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;
    padding: 1.5rem 2rem; background: var(--card-bg); border: 1px solid var(--card-border);
    border-radius: 16px; backdrop-filter: blur(12px);
  }
  h1 {
    font-family: 'Outfit', system-ui, sans-serif; font-weight: 800; font-size: 1.6rem;
    background: linear-gradient(135deg, #f3f4f6 30%, #9ca3af 100%);
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
    letter-spacing: -0.02em;
  }
  .subtitle { font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem; }
  .tabs {
    display: flex; gap: 0.5rem; background: var(--card-bg); border: 1px solid var(--card-border);
    border-radius: 12px; padding: 0.35rem; max-width: 100%; overflow-x: auto; scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    background: transparent; border: none; color: var(--text-secondary); font: inherit;
    font-size: 0.9rem; font-weight: 600; padding: 0.55rem 1.1rem; border-radius: 9px; cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover { color: var(--text-primary); }
  .tab.active { background: rgba(59, 130, 246, 0.15); color: #93c5fd; }
  .tab .count { font-size: 0.7rem; opacity: 0.75; margin-left: 0.3rem; }
  .card {
    background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px;
    padding: 1.5rem; backdrop-filter: blur(12px);
  }
  .card + .card { margin-top: 1rem; }
  .card-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
  h2 { font-family: 'Outfit', system-ui, sans-serif; font-size: 1.15rem; font-weight: 700; }
  h3 { font-family: 'Outfit', system-ui, sans-serif; font-size: 1.05rem; font-weight: 600; }
  .muted { color: var(--text-muted); font-size: 0.8rem; }
  .badge {
    display: inline-flex; align-items: center; padding: 0.3rem 0.7rem; border-radius: 9999px;
    font-size: 0.7rem; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; white-space: nowrap;
  }
  .badge-success { background: rgba(16,185,129,0.12); color: var(--accent-success); border: 1px solid rgba(16,185,129,0.2); }
  .badge-warning { background: rgba(245,158,11,0.12); color: var(--accent-warning); border: 1px solid rgba(245,158,11,0.2); }
  .badge-error   { background: rgba(239,68,68,0.12); color: var(--accent-error); border: 1px solid rgba(239,68,68,0.2); }
  .badge-neutral { background: rgba(156,163,175,0.1); color: var(--text-secondary); border: 1px solid rgba(156,163,175,0.18); }
  button.btn {
    background: var(--accent-primary); color: #fff; border: none; padding: 0.6rem 1.1rem;
    border-radius: 9px; font: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer;
  }
  button.btn:hover:not(:disabled) { background: #2563eb; }
  button.btn:disabled { opacity: 0.5; cursor: not-allowed; }
  button.btn.ghost { background: transparent; border: 1px solid var(--card-border); color: var(--text-secondary); }
  button.btn.ghost:hover:not(:disabled) { background: rgba(255,255,255,0.04); color: var(--text-primary); }
  button.btn.danger { background: transparent; border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; }
  button.btn.danger:hover:not(:disabled) { background: rgba(239,68,68,0.12); }
  .row-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--text-muted); font-weight: 600; padding: 0.6rem 0.5rem; border-bottom: 1px solid var(--card-border);
  }
  td { padding: 0.7rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
  tr.disabled td { opacity: 0.45; }
  select, input[type=text] {
    width: 100%; background: rgba(8,12,20,0.8); color: var(--text-primary);
    border: 1px solid var(--card-border); border-radius: 8px; padding: 0.5rem 0.6rem;
    font: inherit; font-size: 0.85rem;
  }
  select:focus, input[type=text]:focus { outline: none; border-color: var(--accent-primary); }
  select.unset, input.unset { border-color: rgba(245,158,11,0.45); }
  .arrow { color: var(--text-muted); text-align: center; font-size: 1.1rem; }
  .switch { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
  .switch input { accent-color: var(--accent-primary); width: 16px; height: 16px; cursor: pointer; }
  .empty { text-align: center; padding: 2.5rem 1rem; color: var(--text-muted); }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px,1fr)); gap: 1rem; }
  .stat { background: rgba(8,12,20,0.5); border: 1px solid var(--card-border); border-radius: 12px; padding: 1rem 1.2rem; }
  .stat-label { font-size: 0.75rem; color: var(--text-secondary); }
  .stat-value { font-family: 'Outfit', system-ui, sans-serif; font-size: 1.7rem; font-weight: 700; margin-top: 0.2rem; }
  .stat-value.success { color: var(--accent-success); }
  .stat-value.warning { color: var(--accent-warning); }
  .stat-value.error { color: var(--accent-error); }
  .conn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px,1fr)); gap: 1rem; }
  .conn { background: rgba(8,12,20,0.5); border: 1px solid var(--card-border); border-radius: 12px; padding: 1.2rem; display: flex; flex-direction: column; gap: 0.9rem; }
  .conn.expired { border-color: rgba(239,68,68,0.35); }
  .conn.expiring { border-color: rgba(245,158,11,0.35); }
  .conn-accounts { font-size: 0.8rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 0.25rem; }
  .err { color: #fca5a5; font-size: 0.78rem; word-break: break-word; }
  .banner { border-radius: 12px; padding: 0.9rem 1.2rem; font-size: 0.85rem; display: flex; gap: 0.6rem; align-items: flex-start; }
  .banner.warn { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.25); color: #fcd34d; }
  .banner.err { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); color: #fca5a5; }
  .banner.ok { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); color: #6ee7b7; }
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(8px);
    z-index: 999; display: flex; align-items: center; justify-content: center; padding: 1rem;
  }
  .modal {
    background: #0d1320; border: 1px solid var(--card-border); border-radius: 16px;
    padding: 1.75rem; max-width: 560px; width: 100%; max-height: 85vh; overflow-y: auto;
    display: flex; flex-direction: column; gap: 1rem;
  }
  .modal ol { margin-left: 1.1rem; font-size: 0.87rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 0.5rem; }
  .modal a { color: #93c5fd; word-break: break-all; }
  pre.log {
    background: #05070c; border: 1px solid var(--card-border); border-radius: 8px; padding: 0.9rem;
    font-family: ui-monospace, monospace; font-size: 0.75rem; white-space: pre-wrap; word-break: break-word;
    max-height: 320px; overflow-y: auto; color: #cbd5e1;
  }
  .toast {
    position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
    padding: 0.8rem 1.3rem; border-radius: 10px; font-size: 0.87rem; z-index: 1200;
    background: #111827; border: 1px solid var(--card-border); box-shadow: 0 8px 30px rgba(0,0,0,0.5); max-width: 90vw;
  }
  .toast.ok { border-color: rgba(16,185,129,0.4); color: #6ee7b7; }
  .toast.err { border-color: rgba(239,68,68,0.4); color: #fca5a5; }
  .hint { font-size: 0.72rem; color: var(--text-muted); margin-top: 0.3rem; }
  @media (max-width: 720px) {
    body { padding: 1rem 0.5rem; }
    header { flex-direction: column; align-items: stretch; }
    .row-actions { width: 100%; }
    .tabs { flex: 1; }
    header { padding: 1.1rem; }
    .card { padding: 1.1rem; }
    table, thead, tbody, th, td, tr { display: block; }
    thead { display: none; }
    tr { border-bottom: 1px solid var(--card-border); padding: 0.75rem 0; }
    td { border: none; padding: 0.35rem 0; }
    .arrow { text-align: left; }
  }
`;

const SCRIPT = String.raw`
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let BASE = window.location.pathname;
if (!BASE.endsWith("/")) BASE = BASE.replace(/[^/]*$/, "");

let state = { connections: [], mappings: [], actualAccounts: [], flow: "paste" };
let summary = null;
let draft = null;      // working copy of mappings; null when not dirty
let tab = "overview";
let busy = false;

/** When the server requires a token the page is opened as ?token=…; keep it for
 * the session so it stays out of the address bar and off every later link. */
const TOKEN_KEY = "actual-sync-token";
(() => {
  const fromUrl = new URLSearchParams(window.location.search).get("token");
  if (fromUrl) {
    try { sessionStorage.setItem(TOKEN_KEY, fromUrl); } catch (e) {}
    const clean = new URL(window.location.href);
    clean.searchParams.delete("token");
    history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
  }
})();
const token = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };

const api = async (path, opts = {}) => {
  const auth = token();
  const res = await fetch(BASE.replace(/\/$/, "") + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer " + auth } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { error: text }; }
  if (res.status === 401) {
    throw new Error("This dashboard needs a token. Open it as …/?token=YOUR_TOKEN (the value of DASHBOARD_TOKEN).");
  }
  if (!res.ok) throw new Error((body && body.error) || ("Request failed: " + res.status));
  return body;
};

let toastTimer;
const toast = (msg, kind = "ok") => {
  clearTimeout(toastTimer);
  const el = $("toast");
  el.className = "toast " + kind;
  el.textContent = msg;
  el.style.display = "block";
  toastTimer = setTimeout(() => { el.style.display = "none"; }, kind === "err" ? 8000 : 4000);
};

const mappingsView = () => draft ?? state.mappings;

/** Every bank account across all connections, labelled for a picker. */
const bankAccountOptions = () =>
  state.connections.flatMap((c) =>
    (c.accounts || []).map((a) => ({
      value: c.id + "::" + a.id,
      label: c.label + " · " + a.name,
      id: a.id,
      connectionId: c.id,
      status: c.status,
    })));

const load = async (opts = {}) => {
  try {
    state = await api("/api/state");
    if (opts.resetDraft) draft = null;
  } catch (e) { toast("Could not load state: " + e.message, "err"); }
  try { summary = await api("/sync-summary.json"); } catch (e) { summary = null; }
  render();
};

// ---------------------------------------------------------------- rendering

const statusBadge = (c) => {
  if (c.status === "expired") return '<span class="badge badge-error">Expired</span>';
  if (c.status === "expiring")
    return '<span class="badge badge-warning">Expires in ' + c.daysUntilExpiry + 'd</span>';
  if (c.status === "active")
    return '<span class="badge badge-success">Active' +
      (c.daysUntilExpiry != null ? " · " + c.daysUntilExpiry + "d left" : "") + '</span>';
  return '<span class="badge badge-neutral">Unknown</span>';
};

const renderOverview = () => {
  const needsAttention = state.connections.filter((c) => c.status === "expired" || c.status === "expiring");
  let html = "";

  if (needsAttention.length) {
    html += '<div class="banner ' + (needsAttention.some((c) => c.status === "expired") ? "err" : "warn") + '">' +
      "<div><strong>" + needsAttention.length + " connection" + (needsAttention.length > 1 ? "s need" : " needs") +
      " attention.</strong><br>" +
      needsAttention.map((c) => esc(c.label) + " — " +
        (c.status === "expired" ? "consent expired" : "expires in " + c.daysUntilExpiry + " days")).join("<br>") +
      '<br><button class="btn ghost" style="margin-top:.6rem" onclick="go(\'connections\')">Go to connections</button>' +
      "</div></div>";
  }

  if (!summary) {
    html += '<div class="card"><div class="empty">No sync has run yet.<br><br>' +
      '<button class="btn" onclick="runSync()">Run the first sync</button></div></div>';
    return html;
  }

  const o = summary.overall || {};
  html += '<div class="card"><div class="card-head"><h2>Last sync</h2>' +
    '<span class="muted">' + (summary.lastSyncTime ? new Date(summary.lastSyncTime).toLocaleString() : "never") + "</span></div>" +
    '<div class="stats" style="margin-top:1rem">' +
    stat("Accounts synced", o.accountSyncs ?? 0) +
    stat("New transactions", o.newTransactions ?? 0, "success") +
    stat("Balance mismatches", o.balanceMismatches ?? 0, (o.balanceMismatches ? "warning" : "")) +
    stat("Failed", (o.failures || []).length, ((o.failures || []).length ? "error" : "")) +
    "</div>";

  if ((o.failures || []).length) {
    html += '<div class="banner err" style="margin-top:1rem"><div>' +
      o.failures.map((f) => "<strong>" + esc(f.name) + "</strong>: " + esc(f.reason)).join("<br>") +
      "</div></div>";
  }
  html += "</div>";

  const accounts = summary.accounts || [];
  if (accounts.length) {
    html += '<div class="card"><h2>Accounts</h2><table style="margin-top:.75rem"><thead><tr>' +
      "<th>Account</th><th>Bank balance</th><th>Actual balance</th><th>Added</th><th>Status</th>" +
      "</tr></thead><tbody>" +
      accounts.map((a) => {
        const b = a.balances || {};
        const cur = b.currency || "GBP";
        return "<tr><td><strong>" + esc(a.name) + "</strong></td>" +
          "<td>" + cur + " " + (b.online ?? 0).toFixed(2) + "</td>" +
          "<td>" + cur + " " + (b.actual ?? 0).toFixed(2) + "</td>" +
          "<td>" + (a.added ?? 0) + "</td>" +
          "<td>" + (b.match ? '<span class="badge badge-success">Match</span>'
                            : '<span class="badge badge-warning">Mismatch</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  return html;
};

const stat = (label, value, kind = "") =>
  '<div class="stat"><div class="stat-label">' + label + '</div>' +
  '<div class="stat-value ' + kind + '">' + value + "</div></div>";

const renderConnections = () => {
  if (!state.connections.length) {
    return '<div class="card"><div class="empty">No banks connected yet.<br><br>' +
      '<button class="btn" onclick="startAuth(null)">Connect a bank</button></div></div>';
  }
  const mapped = mappingsView();
  return '<div class="card"><div class="card-head"><h2>Bank connections</h2>' +
    '<div class="row-actions">' +
    '<button class="btn ghost" onclick="refreshAccounts()">Refresh accounts</button>' +
    '<button class="btn" onclick="startAuth(null)">Connect a bank</button></div></div>' +
    '<div class="conn-grid" style="margin-top:1rem">' +
    state.connections.map((c) => {
      const accts = c.accounts || [];
      const unmapped = accts.filter((a) => !mapped.some((m) => m.truelayerAccountId === a.id));
      return '<div class="conn ' + esc(c.status) + '">' +
        '<div class="card-head"><h3>' + esc(c.label) + "</h3>" + statusBadge(c) + "</div>" +
        '<div class="conn-accounts">' +
        (accts.length
          ? accts.map((a) => "<div>" + esc(a.name) +
              (unmapped.some((u) => u.id === a.id)
                ? ' <span class="badge badge-warning" style="font-size:.6rem">Not mapped</span>' : "") +
              "</div>").join("")
          : '<div class="muted">No accounts on record</div>') +
        "</div>" +
        '<div class="muted">Last refreshed: ' +
          (c.lastRefreshAt ? new Date(c.lastRefreshAt).toLocaleString() : "never") + "</div>" +
        (c.lastRefreshError ? '<div class="err">' + esc(c.lastRefreshError) + "</div>" : "") +
        '<div class="row-actions">' +
        '<button class="btn" onclick="startAuth(\'' + c.id + '\')">' +
          (c.status === "expired" ? "Reconnect" : "Refresh key") + "</button>" +
        '<button class="btn danger" onclick="removeConnection(\'' + c.id + '\',\'' + esc(c.label).replace(/'/g, "&#39;") + '\')">Remove</button>' +
        "</div></div>";
    }).join("") + "</div></div>";
};

const renderMappings = () => {
  const rows = mappingsView();
  const bankOpts = bankAccountOptions();
  const dirty = draft !== null;

  if (!state.connections.length) {
    return '<div class="card"><div class="empty">Connect a bank first — mappings need accounts to choose from.<br><br>' +
      '<button class="btn" onclick="startAuth(null)">Connect a bank</button></div></div>';
  }

  const mappedBank = new Set(rows.map((r) => r.truelayerAccountId));
  const unmapped = bankOpts.filter((o) => !mappedBank.has(o.id));

  let html = '<div class="card"><div class="card-head"><h2>Account mapping</h2>' +
    '<div class="row-actions">' +
    '<button class="btn ghost" onclick="addRow()">Add mapping</button>' +
    '<button class="btn ghost" onclick="discard()" ' + (dirty ? "" : "disabled") + ">Discard</button>" +
    '<button class="btn" onclick="save()" ' + (dirty && !busy ? "" : "disabled") + ">Save changes</button>" +
    "</div></div>";

  if (unmapped.length) {
    html += '<div class="banner warn" style="margin-top:1rem"><div>' +
      unmapped.length + " bank account" + (unmapped.length > 1 ? "s are" : " is") +
      " not mapped to Actual yet: " + unmapped.map((o) => esc(o.label)).join(", ") + "</div></div>";
  }

  if (!rows.length) {
    html += '<div class="empty">No mappings yet. Add one to start syncing.</div></div>';
    return html;
  }

  html += '<table style="margin-top:1rem"><thead><tr>' +
    "<th style=\"width:20%\">Name</th><th style=\"width:28%\">Bank account</th><th style=\"width:4%\"></th>" +
    "<th style=\"width:28%\">Actual account</th><th style=\"width:20%\">Options</th>" +
    "</tr></thead><tbody>" +
    rows.map((m, i) => {
      const bankValue = m.connectionId && m.truelayerAccountId ? m.connectionId + "::" + m.truelayerAccountId : "";
      const knownBank = bankOpts.some((o) => o.value === bankValue);
      const knownActual = state.actualAccounts.some((a) => a.id === m.actualAccountId);
      return '<tr class="' + (m.enabled === false ? "disabled" : "") + '">' +
        '<td><input type="text" class="' + (m.name ? "" : "unset") + '" value="' + esc(m.name) +
          '" placeholder="e.g. Monzo Current" oninput="edit(' + i + ',\'name\',this.value)"></td>' +
        "<td>" + select(
            bankOpts.map((o) => ({ value: o.value, label: o.label })),
            bankValue, knownBank,
            "edit(" + i + ",'bank',this.value)",
            m.truelayerAccountId) +
        "</td>" +
        '<td class="arrow">&rarr;</td>' +
        "<td>" + select(
            state.actualAccounts.map((a) => ({ value: a.id, label: a.name })),
            m.actualAccountId, knownActual,
            "edit(" + i + ",'actual',this.value)",
            m.actualAccountId) +
        "</td>" +
        '<td><div style="display:flex;flex-direction:column;gap:.4rem">' +
          '<label class="switch"><input type="checkbox" ' + (m.enabled !== false ? "checked" : "") +
            ' onchange="edit(' + i + ',\'enabled\',this.checked)">Enabled</label>' +
          '<label class="switch"><input type="checkbox" ' + (m.mapConfig && m.mapConfig.invertAmount ? "checked" : "") +
            ' onchange="edit(' + i + ',\'invert\',this.checked)">Invert amounts</label>' +
          '<button class="btn danger" onclick="removeRow(' + i + ')">Remove</button>' +
        "</div></td></tr>";
    }).join("") +
    "</tbody></table>" +
    '<div class="hint">Amounts are inverted for accounts where a charge should reduce the Actual balance — typically credit cards.</div>' +
    "</div>";
  return html;
};

/** A picker that shows names only; the raw id lives in the tooltip. */
const select = (options, value, known, handler, tooltip) => {
  const missing = value && !known;
  return '<select class="' + (value && !missing ? "" : "unset") + '" title="' + esc(tooltip || "") +
    '" onchange="' + handler + '">' +
    '<option value="">— choose —</option>' +
    options.map((o) => '<option value="' + esc(o.value) + '"' + (o.value === value ? " selected" : "") +
      ">" + esc(o.label) + "</option>").join("") +
    (missing ? '<option value="' + esc(value) + '" selected>⚠ Unknown account (' + esc(value) + ")</option>" : "") +
    "</select>";
};

const render = () => {
  const counts = { connections: state.connections.length, mappings: mappingsView().length };
  $("tabs").innerHTML = [
    ["overview", "Overview", null],
    ["connections", "Connections", counts.connections],
    ["mappings", "Mappings", counts.mappings],
  ].map(([id, label, n]) =>
    '<button class="tab ' + (tab === id ? "active" : "") + '" onclick="go(\'' + id + '\')">' +
    label + (n != null ? '<span class="count">' + n + "</span>" : "") + "</button>").join("");

  $("view").innerHTML =
    tab === "overview" ? renderOverview() :
    tab === "connections" ? renderConnections() :
    renderMappings();

  $("dirty").style.display = draft !== null ? "inline-flex" : "none";
};

window.go = (t) => { tab = t; render(); };

// ---------------------------------------------------------------- mappings

window.edit = (i, field, value) => {
  if (draft === null) draft = JSON.parse(JSON.stringify(state.mappings));
  const row = draft[i];
  if (!row) return;
  if (field === "name") { row.name = value; return; }          // no re-render: keeps caret
  if (field === "bank") {
    const [connectionId, accountId] = value.split("::");
    row.connectionId = connectionId || "";
    row.truelayerAccountId = accountId || "";
    // Borrow the account's name for a row the user has not named yet.
    if (!row.name && accountId) {
      const opt = bankAccountOptions().find((o) => o.id === accountId);
      if (opt) row.name = opt.label;
    }
  }
  if (field === "actual") row.actualAccountId = value;
  if (field === "enabled") row.enabled = value;
  if (field === "invert") row.mapConfig = { ...(row.mapConfig || {}), invertAmount: value };
  render();
};

window.addRow = () => {
  if (draft === null) draft = JSON.parse(JSON.stringify(state.mappings));
  draft.push({ id: "", name: "", connectionId: "", truelayerAccountId: "", actualAccountId: "", mapConfig: {}, enabled: true });
  render();
};

window.removeRow = (i) => {
  if (draft === null) draft = JSON.parse(JSON.stringify(state.mappings));
  draft.splice(i, 1);
  render();
};

window.discard = () => { draft = null; render(); };

window.save = async () => {
  const rows = mappingsView();
  const incomplete = rows.filter((r) => !r.name || !r.truelayerAccountId || !r.actualAccountId);
  if (incomplete.length) {
    toast(incomplete.length + " mapping(s) are incomplete — every row needs a name, a bank account and an Actual account.", "err");
    return;
  }
  const dupes = rows.filter((r, i) => rows.findIndex((o) => o.actualAccountId === r.actualAccountId) !== i);
  if (dupes.length && !confirm("More than one mapping points at the same Actual account. Transactions from both banks will land in it. Continue?")) return;

  busy = true; render();
  try {
    const result = await api("/api/mappings", { method: "PUT", body: JSON.stringify({ mappings: rows }) });
    draft = null;
    toast("Saved " + result.count + " mapping" + (result.count === 1 ? "" : "s") + ".");
    await load({ resetDraft: true });
  } catch (e) {
    toast("Save failed: " + e.message, "err");
  } finally { busy = false; render(); }
};

// ------------------------------------------------------------- connections

window.refreshAccounts = async () => {
  toast("Refreshing accounts from your banks…");
  try {
    const res = await api("/api/accounts/refresh", { method: "POST" });
    await load();
    const remapped = (res.reports || []).flatMap((r) => r.remapped || []);
    toast(remapped.length
      ? "Accounts refreshed. " + remapped.length + " account id(s) changed; mappings were updated to follow."
      : "Accounts refreshed.");
  } catch (e) { toast("Refresh failed: " + e.message, "err"); }
};

window.removeConnection = async (id, label) => {
  if (!confirm('Remove the connection to "' + label + '"?\n\nIts mappings are removed too. Transactions already imported into Actual are not touched.')) return;
  try {
    const res = await api("/api/connections/" + encodeURIComponent(id), { method: "DELETE" });
    await load({ resetDraft: true });
    toast("Connection removed" + (res.removedMappings ? ", along with " + res.removedMappings + " mapping(s)." : "."));
  } catch (e) { toast("Could not remove: " + e.message, "err"); }
};

/** Kick off consent. With a server callback configured we just poll for the
 * result; otherwise the user pastes the code back from the redirect page. */
window.startAuth = async (connectionId) => {
  let info;
  try {
    info = await api("/api/truelayer/auth-url" + (connectionId ? "?connectionId=" + encodeURIComponent(connectionId) : ""));
  } catch (e) { toast("Could not start authentication: " + e.message, "err"); return; }

  window.open(info.url, "_blank", "noopener");

  if (info.flow === "callback") {
    showModal(
      "<h2>Authorising with your bank</h2>" +
      '<ol><li>Finish the consent in the tab that just opened.</li>' +
      "<li>You will be sent back here automatically.</li></ol>" +
      '<p class="muted">Waiting for the bank to redirect…</p>' +
      '<div class="row-actions"><button class="btn ghost" onclick="closeModal()">Cancel</button></div>');
    pollAuth(info.pending);
    return;
  }

  showModal(
    "<h2>Connect your bank</h2>" +
    "<ol><li>Finish the consent in the tab that just opened.</li>" +
    "<li>You land on the TrueLayer redirect page, which shows a <strong>code</strong>.</li>" +
    "<li>Paste that code below.</li></ol>" +
    '<div><input type="text" id="authCode" placeholder="Paste the code here" autocomplete="off"></div>' +
    '<div class="row-actions">' +
    '<button class="btn" onclick="submitCode(' + (connectionId ? "'" + connectionId + "'" : "null") + ')">Connect</button>' +
    '<button class="btn ghost" onclick="closeModal()">Cancel</button></div>' +
    '<div id="modalMsg"></div>');
  setTimeout(() => $("authCode") && $("authCode").focus(), 50);
};

window.submitCode = async (connectionId) => {
  const code = ($("authCode").value || "").trim();
  if (!code) { $("modalMsg").innerHTML = '<div class="banner err"><div>Paste the code first.</div></div>'; return; }
  $("modalMsg").innerHTML = '<p class="muted">Exchanging the code with TrueLayer…</p>';
  try {
    const res = await api("/api/truelayer/exchange", {
      method: "POST",
      body: JSON.stringify({ code, connectionId: connectionId || undefined }),
    });
    showReconcileResult(res.report);
    await load({ resetDraft: true });
  } catch (e) {
    $("modalMsg").innerHTML = '<div class="banner err"><div>' + esc(e.message) + "</div></div>";
  }
};

const pollAuth = (pendingId) => {
  const started = Date.now();
  const timer = setInterval(async () => {
    if (!$("modalOverlay")) { clearInterval(timer); return; }
    if (Date.now() - started > 10 * 60 * 1000) {
      clearInterval(timer);
      showModal('<div class="banner err"><div>Timed out waiting for the bank. Try again.</div></div>' +
        '<div class="row-actions"><button class="btn ghost" onclick="closeModal()">Close</button></div>');
      return;
    }
    try {
      const res = await api("/api/truelayer/pending/" + encodeURIComponent(pendingId));
      if (res.status === "done") {
        clearInterval(timer);
        showReconcileResult(res.report);
        await load({ resetDraft: true });
      } else if (res.status === "error") {
        clearInterval(timer);
        showModal('<div class="banner err"><div>' + esc(res.error) + "</div></div>" +
          '<div class="row-actions"><button class="btn ghost" onclick="closeModal()">Close</button></div>');
      }
    } catch (e) { /* keep waiting */ }
  }, 2000);
};

/** Show exactly what the reconcile did, so an account-id change is never silent. */
const showReconcileResult = (report) => {
  let html = '<h2>Connected</h2><div class="banner ok"><div>' +
    esc(report.label) + " is connected and its key has been refreshed.</div></div>";

  if ((report.remapped || []).length) {
    html += '<div class="banner warn"><div><strong>Account ids changed at the bank.</strong><br>' +
      report.remapped.map((r) => esc(r.name) + " — " +
        (r.mappings ? r.mappings + " mapping(s) updated to follow" : "no mappings affected")).join("<br>") +
      "</div></div>";
  }
  if ((report.missing || []).length) {
    html += '<div class="banner err"><div><strong>No longer shared by this consent:</strong><br>' +
      report.missing.map((m) => esc(m.name) +
        (m.mappings ? " — " + m.mappings + " mapping(s) now point at a missing account" : "")).join("<br>") +
      "</div></div>";
  }
  if ((report.unmapped || []).length) {
    html += '<div class="banner warn"><div><strong>Not mapped to Actual yet:</strong><br>' +
      report.unmapped.map((a) => esc(a.name)).join("<br>") +
      '<br><button class="btn ghost" style="margin-top:.6rem" onclick="closeModal();go(\'mappings\')">Map them now</button></div></div>';
  }
  html += '<div class="row-actions"><button class="btn" onclick="closeModal()">Done</button></div>';
  showModal(html);
};

// -------------------------------------------------------------------- sync

window.runSync = async () => {
  showModal("<h2>Running sync</h2><pre class=\"log\" id=\"syncLog\">Starting…</pre>" +
    '<div class="row-actions"><button class="btn ghost" onclick="closeModal()">Close</button></div>');
  try {
    const res = await api("/api/run", { method: "POST" });
    const timer = setInterval(async () => {
      if (!$("syncLog")) { clearInterval(timer); return; }
      try {
        const d = await api("/api/logs/" + encodeURIComponent(res.job_id));
        if (d.logs) {
          $("syncLog").textContent = d.logs;
          $("syncLog").scrollTop = $("syncLog").scrollHeight;
        }
        if (d.status === "success" || d.status === "failed") {
          clearInterval(timer);
          toast(d.status === "success" ? "Sync finished." : "Sync failed — see the log.", d.status === "success" ? "ok" : "err");
          await load();
        }
      } catch (e) { clearInterval(timer); }
    }, 1500);
  } catch (e) {
    if ($("syncLog")) $("syncLog").textContent = "Could not start sync: " + e.message;
  }
};

// ------------------------------------------------------------------- modal

const showModal = (html) => {
  let overlay = $("modalOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "modalOverlay";
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '<div class="modal">' + html + "</div>";
};
window.closeModal = () => {
  const overlay = $("modalOverlay");
  if (overlay) overlay.remove();
};
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

window.addEventListener("beforeunload", (e) => {
  if (draft !== null) { e.preventDefault(); e.returnValue = ""; }
});

// Complete a server-side callback that landed on this page.
const params = new URLSearchParams(window.location.search);
if (params.get("connected") === "1") {
  history.replaceState({}, "", window.location.pathname);
  tab = "connections";
}

load();
`;

export const renderDashboardApp = (): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Actual Sync</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${STYLES}</style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Actual Sync</h1>
        <div class="subtitle">Bank connections and account mapping
          <span id="dirty" class="badge badge-warning" style="display:none;margin-left:.5rem">Unsaved changes</span>
        </div>
      </div>
      <div class="row-actions">
        <div class="tabs" id="tabs"></div>
        <button class="btn" onclick="runSync()">Run sync</button>
      </div>
    </header>
    <div id="view"></div>
  </div>
  <div id="toast" class="toast" style="display:none"></div>
  <script>${SCRIPT}</script>
</body>
</html>`;
