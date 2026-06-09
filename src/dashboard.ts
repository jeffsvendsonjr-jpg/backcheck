import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/mastra",
});

async function getDashboardData() {
  let apps: any[] = [];
  let pulse = { total_checks: 0, total_issues: 0, total_down: 0, week_start: null as any, last_pulse_sent: null as any };
  let recentRuns: any[] = [];
  let recentNotifications: any[] = [];

  try {
    const appResult = await pool.query(
      `SELECT url, last_status, consecutive_failures, consecutive_slow, content_hash, updated_at
       FROM backcheck_app_state ORDER BY url`
    );
    apps = appResult.rows;
  } catch (e) {}

  try {
    const pulseResult = await pool.query(
      `SELECT total_checks, total_issues, total_down, week_start, last_pulse_sent FROM backcheck_pulse WHERE id = 1`
    );
    if (pulseResult.rows.length > 0) pulse = pulseResult.rows[0];
  } catch (e) {}

  try {
    const runsResult = await pool.query(
      `SELECT run_id, apps_checked, apps_healthy, apps_down, apps_issues,
              notification_sent, notification_error, completed_at
       FROM backcheck_run_log
       ORDER BY completed_at DESC
       LIMIT 5`
    );
    recentRuns = runsResult.rows;
  } catch (e) {}

  try {
    const notifResult = await pool.query(
      `SELECT notification_type, subject, success, error, platform, attempted_at
       FROM backcheck_notification_log
       ORDER BY attempted_at DESC
       LIMIT 5`
    );
    recentNotifications = notifResult.rows;
  } catch (e) {}

  const appUrlsRaw = process.env.APP_URLS || "";
  const configuredUrls = appUrlsRaw
    .split(",")
    .map((e: string) => e.trim())
    .filter(Boolean)
    .map((entry: string) => {
      const parts = entry.split("|");
      const name = parts.length > 1 ? parts[0].trim() : parts[0].trim();
      const url = parts.length > 1 ? parts[1].trim() : parts[0].trim();
      const signals = parts.length > 2 ? parts[2].trim() : "";
      return { name, url, signals };
    });

  return { apps, pulse, configuredUrls, schedule: process.env.SCHEDULE_CRON_EXPRESSION || "0 * * * *", notifyMode: process.env.NOTIFY_MODE || "all", recentRuns, recentNotifications };
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return "never";
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export async function getDashboardHtml(): Promise<string> {
  const { apps, pulse, configuredUrls, schedule, notifyMode, recentRuns, recentNotifications } = await getDashboardData();

  const mergedApps = configuredUrls.map((configured) => {
    const state = apps.find((a) => a.url === configured.url);
    return { ...configured, state };
  });

  const healthyCount = mergedApps.filter(a => a.state?.last_status === "healthy").length;
  const downCount = mergedApps.filter(a => a.state?.last_status === "down").length;
  const issueCount = mergedApps.filter(a => a.state?.last_status === "issues").length;
  const uncheckedCount = mergedApps.filter(a => !a.state).length;

  const overallStatus = downCount > 0 ? "down" : issueCount > 0 ? "issues" : mergedApps.length === 0 ? "empty" : "healthy";

  const appRows = mergedApps.length === 0
    ? `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--muted);">No apps configured yet — set the <code style="color:var(--accent)">APP_URLS</code> environment variable to start monitoring.</td></tr>`
    : mergedApps.map((app) => {
        const status = app.state?.last_status ?? "pending";
        const failures = app.state?.consecutive_failures ?? 0;
        const slow = app.state?.consecutive_slow ?? 0;
        const updatedAt = app.state?.updated_at ? new Date(app.state.updated_at) : null;

        const statusDot = status === "healthy"
          ? `<span class="dot dot-green"></span><span class="status-text green">Healthy</span>`
          : status === "down"
          ? `<span class="dot dot-red"></span><span class="status-text red">Down</span>`
          : status === "issues"
          ? `<span class="dot dot-amber"></span><span class="status-text amber">Issues</span>`
          : `<span class="dot dot-gray"></span><span class="status-text gray">Pending</span>`;

        const badges = [];
        if (failures > 0) badges.push(`<span class="badge badge-red">${failures} consecutive fail${failures !== 1 ? "s" : ""}</span>`);
        if (slow >= 2) badges.push(`<span class="badge badge-amber">slow</span>`);

        return `<tr>
          <td>
            <div class="app-name">${app.name}</div>
            <div class="app-url"><a href="${app.url}" target="_blank" rel="noopener">${app.url}</a></div>
            ${app.signals ? `<div class="app-signals">${app.signals}</div>` : ""}
          </td>
          <td><div class="status-cell">${statusDot}</div></td>
          <td><span class="time-cell">${formatRelativeTime(updatedAt)}</span></td>
          <td>${badges.length ? badges.join(" ") : '<span style="color:var(--muted);font-size:13px;">—</span>'}</td>
          <td><a href="${app.url}" target="_blank" class="visit-btn">Visit ↗</a></td>
        </tr>`;
      }).join("");

  // Build recent runs rows
  const recentRunsRows = recentRuns.length === 0
    ? `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);font-size:13px;">No runs recorded yet — the workflow hasn't completed a full cycle.</td></tr>`
    : recentRuns.map((run: any) => {
        const completedAt = run.completed_at ? new Date(run.completed_at) : null;
        const notifIcon = run.notification_sent === true
          ? `<span style="color:var(--accent)">✓ sent</span>`
          : run.notification_sent === false && run.notification_error
          ? `<span style="color:var(--red)" title="${run.notification_error}">✗ failed</span>`
          : run.notification_sent === false
          ? `<span style="color:var(--muted)">— skipped</span>`
          : `<span style="color:var(--muted)">—</span>`;
        const issuesBadge = run.apps_down > 0
          ? `<span class="badge badge-red">${run.apps_down} down</span>`
          : run.apps_issues > 0
          ? `<span class="badge badge-amber">${run.apps_issues} issues</span>`
          : `<span style="color:var(--accent);font-size:12px;">all healthy</span>`;
        return `<tr>
          <td><span class="time-cell">${formatRelativeTime(completedAt)}</span></td>
          <td style="font-size:13px;">${run.apps_checked}</td>
          <td>${issuesBadge}</td>
          <td>${notifIcon}</td>
          <td style="font-size:11px;color:var(--muted);font-family:monospace;">${run.run_id ? run.run_id.slice(0, 16) + "…" : "—"}</td>
        </tr>`;
      }).join("");

  // Build recent notifications rows
  const recentNotifsRows = recentNotifications.length === 0
    ? `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted);font-size:13px;">No notifications recorded yet.</td></tr>`
    : recentNotifications.map((n: any) => {
        const attemptedAt = n.attempted_at ? new Date(n.attempted_at) : null;
        const typeLabel = n.notification_type === "email"
          ? `<span style="font-size:12px;">📧 Email</span>`
          : `<span style="font-size:12px;">🔔 Webhook${n.platform ? ` (${n.platform})` : ""}</span>`;
        const statusLabel = n.success
          ? `<span style="color:var(--accent)">✓ sent</span>`
          : `<span style="color:var(--red)" title="${n.error || "unknown error"}">✗ failed</span>`;
        return `<tr>
          <td><span class="time-cell">${formatRelativeTime(attemptedAt)}</span></td>
          <td>${typeLabel}</td>
          <td style="font-size:12px;color:var(--muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${n.subject || ""}">${n.subject || "—"}</td>
          <td>${statusLabel}</td>
        </tr>`;
      }).join("");

  const overallBanner = overallStatus === "healthy"
    ? `<div class="banner banner-green"><span class="banner-dot"></span>All systems operational</div>`
    : overallStatus === "down"
    ? `<div class="banner banner-red"><span class="banner-dot"></span>${downCount} app${downCount !== 1 ? "s" : ""} down</div>`
    : overallStatus === "issues"
    ? `<div class="banner banner-amber"><span class="banner-dot"></span>${issueCount} app${issueCount !== 1 ? "s" : ""} with issues</div>`
    : `<div class="banner banner-gray"><span class="banner-dot"></span>No apps configured</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Backcheck — Live Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0b;
      --surface: #141416;
      --surface2: #1a1a1d;
      --border: #1e1e22;
      --text: #e4e4e7;
      --muted: #71717a;
      --accent: #22c55e;
      --accent-dim: rgba(34,197,94,0.12);
      --red: #ef4444;
      --red-dim: rgba(239,68,68,0.12);
      --amber: #f59e0b;
      --amber-dim: rgba(245,158,11,0.12);
    }
    body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; -webkit-font-smoothing: antialiased; }
    nav { padding: 20px 32px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
    .logo { font-size: 17px; font-weight: 700; letter-spacing: -0.02em; text-decoration: none; color: var(--text); }
    .logo span { color: var(--accent); }
    .nav-right { display: flex; align-items: center; gap: 16px; }
    .nav-link { font-size: 13px; color: var(--muted); text-decoration: none; transition: color 0.2s; }
    .nav-link:hover { color: var(--text); }
    .refresh-btn { font-size: 12px; background: var(--surface2); border: 1px solid var(--border); color: var(--muted); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-family: inherit; transition: color 0.2s, border-color 0.2s; }
    .refresh-btn:hover { color: var(--text); border-color: var(--accent); }
    .container { max-width: 960px; margin: 0 auto; padding: 0 32px; }
    .page-header { padding: 40px 0 24px; }
    .page-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 6px; }
    .page-sub { font-size: 14px; color: var(--muted); }
    .banner { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 100px; font-size: 13px; font-weight: 500; margin-bottom: 28px; }
    .banner-green { background: var(--accent-dim); color: var(--accent); }
    .banner-red { background: var(--red-dim); color: var(--red); }
    .banner-amber { background: var(--amber-dim); color: var(--amber); }
    .banner-gray { background: var(--surface2); color: var(--muted); }
    .banner-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 32px; }
    .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; }
    .stat-num { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
    .stat-label { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .stat-green { color: var(--accent); }
    .stat-red { color: var(--red); }
    .stat-amber { color: var(--amber); }
    .table-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 32px; }
    .table-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
    .table-title { font-size: 13px; font-weight: 600; }
    .table-count { font-size: 12px; color: var(--muted); background: var(--surface2); padding: 3px 8px; border-radius: 100px; }
    table { width: 100%; border-collapse: collapse; }
    th { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding: 12px 20px; text-align: left; border-bottom: 1px solid var(--border); }
    td { padding: 16px 20px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--surface2); }
    .app-name { font-size: 14px; font-weight: 600; margin-bottom: 2px; }
    .app-url a { font-size: 12px; color: var(--muted); text-decoration: none; }
    .app-url a:hover { color: var(--accent); }
    .app-signals { font-size: 11px; color: var(--muted); margin-top: 3px; font-family: monospace; }
    .status-cell { display: flex; align-items: center; gap: 7px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot-green { background: var(--accent); }
    .dot-red { background: var(--red); }
    .dot-amber { background: var(--amber); }
    .dot-gray { background: var(--muted); }
    .status-text { font-size: 13px; font-weight: 500; }
    .status-text.green { color: var(--accent); }
    .status-text.red { color: var(--red); }
    .status-text.amber { color: var(--amber); }
    .status-text.gray { color: var(--muted); }
    .time-cell { font-size: 13px; color: var(--muted); }
    .badge { font-size: 11px; padding: 3px 8px; border-radius: 100px; font-weight: 500; }
    .badge-red { background: var(--red-dim); color: var(--red); }
    .badge-amber { background: var(--amber-dim); color: var(--amber); }
    .visit-btn { font-size: 12px; color: var(--muted); text-decoration: none; padding: 5px 10px; border: 1px solid var(--border); border-radius: 6px; transition: color 0.2s, border-color 0.2s; }
    .visit-btn:hover { color: var(--accent); border-color: var(--accent); }
    .pulse-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 32px; }
    .pulse-title { font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    .pulse-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .pulse-item { text-align: center; }
    .pulse-num { font-size: 22px; font-weight: 700; color: var(--accent); }
    .pulse-label { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .config-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 32px; }
    .config-pill { font-size: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; color: var(--muted); }
    .config-pill strong { color: var(--text); }
    .test-section { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 32px; }
    .test-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
    .test-desc { font-size: 13px; color: var(--muted); margin-bottom: 16px; line-height: 1.6; }
    .test-btn { background: var(--red-dim); color: var(--red); border: 1px solid rgba(239,68,68,0.3); padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.2s; }
    .test-btn:hover { background: rgba(239,68,68,0.2); }
    .test-result { margin-top: 14px; font-size: 13px; display: none; }
    footer { border-top: 1px solid var(--border); padding: 24px 32px; display: flex; align-items: center; justify-content: space-between; }
    .footer-left { font-size: 12px; color: var(--muted); }
    .footer-right { font-size: 12px; color: var(--muted); }
    .footer-right a { color: var(--muted); text-decoration: none; }
    .footer-right a:hover { color: var(--accent); }
    @media (max-width: 640px) {
      .stats-row { grid-template-columns: repeat(2, 1fr); }
      nav { padding: 16px 20px; }
      .container { padding: 0 20px; }
    }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo">back<span>check</span></a>
  <div class="nav-right">
    <a href="/" class="nav-link">← Home</a>
    <button class="refresh-btn" onclick="location.reload()">Refresh</button>
  </div>
</nav>

<div class="container">
  <div class="page-header">
    <div class="page-title">Live Dashboard</div>
    <div class="page-sub">Real-time status of all monitored apps. Updates on page refresh.</div>
  </div>

  ${overallBanner}

  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-num stat-green">${healthyCount}</div>
      <div class="stat-label">Healthy</div>
    </div>
    <div class="stat-card">
      <div class="stat-num stat-red">${downCount}</div>
      <div class="stat-label">Down</div>
    </div>
    <div class="stat-card">
      <div class="stat-num stat-amber">${issueCount}</div>
      <div class="stat-label">Issues</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--muted)">${mergedApps.length}</div>
      <div class="stat-label">Monitored</div>
    </div>
  </div>

  <div class="table-card">
    <div class="table-header">
      <div class="table-title">Monitored Apps</div>
      <div class="table-count">${mergedApps.length} app${mergedApps.length !== 1 ? "s" : ""}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>App</th>
          <th>Status</th>
          <th>Last Checked</th>
          <th>Alerts</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${appRows}
      </tbody>
    </table>
  </div>

  <div class="pulse-card">
    <div class="pulse-title">Weekly Pulse — Since ${pulse.week_start ? new Date(pulse.week_start).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</div>
    <div class="pulse-grid">
      <div class="pulse-item">
        <div class="pulse-num">${pulse.total_checks}</div>
        <div class="pulse-label">Total checks run</div>
      </div>
      <div class="pulse-item">
        <div class="pulse-num">${pulse.total_issues}</div>
        <div class="pulse-label">Issues detected</div>
      </div>
      <div class="pulse-item">
        <div class="pulse-num">${pulse.total_down}</div>
        <div class="pulse-label">Downtime incidents</div>
      </div>
    </div>
  </div>

  <div class="config-row">
    <div class="config-pill"><strong>Schedule:</strong> ${schedule}</div>
    <div class="config-pill"><strong>Notify mode:</strong> ${notifyMode}</div>
    <div class="config-pill"><strong>Generated:</strong> ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</div>
  </div>

  <div class="test-section">
    <div class="test-title">🧪 Live Demo — Trigger a Test Alert</div>
    <div class="test-desc">Hit the button below to simulate a down app. Backcheck will detect it, and an alert email will be sent to the configured address. This proves the monitoring pipeline works end-to-end.</div>
    <button class="test-btn" onclick="triggerTest(this)">Trigger a test failure →</button>
    <div class="test-result" id="testResult"></div>
  </div>

  <div class="table-card">
    <div class="table-header">
      <div class="table-title">Recent Runs</div>
      <div class="table-count">${recentRuns.length} shown</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Completed</th>
          <th>Checked</th>
          <th>Outcome</th>
          <th>Notification</th>
          <th>Run ID</th>
        </tr>
      </thead>
      <tbody>
        ${recentRunsRows}
      </tbody>
    </table>
  </div>

  <div class="table-card">
    <div class="table-header">
      <div class="table-title">Recent Notifications</div>
      <div class="table-count">${recentNotifications.length} shown</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Sent</th>
          <th>Channel</th>
          <th>Subject</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${recentNotifsRows}
      </tbody>
    </table>
  </div>
</div>

<footer>
  <div class="footer-left">backcheck — silence is healthy</div>
  <div class="footer-right"><a href="/">Home</a></div>
</footer>

<script>
async function triggerTest(btn) {
  btn.disabled = true;
  btn.textContent = 'Triggering...';
  const result = document.getElementById('testResult');
  result.style.display = 'none';
  try {
    const res = await fetch('/api/test-failure', { method: 'POST' });
    const data = await res.json();
    result.style.display = 'block';
    if (data.success) {
      result.style.color = '#22c55e';
      result.textContent = '✓ Test triggered. Backcheck is running a check now — an alert email will arrive within 30 seconds.';
    } else {
      result.style.color = '#ef4444';
      result.textContent = '✗ ' + (data.error || 'Something went wrong.');
    }
  } catch(e) {
    result.style.display = 'block';
    result.style.color = '#ef4444';
    result.textContent = '✗ Request failed: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Trigger a test failure →';
  }
}
</script>

</body>
</html>`;
}
