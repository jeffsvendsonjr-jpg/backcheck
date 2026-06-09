import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/mastra",
});

export interface AppState {
  url: string;
  content_hash: string | null;
  pending_content_hash: string | null;
  consecutive_failures: number;
  consecutive_slow: number;
  last_status: string | null;
  updated_at: Date;
}

export async function getAppState(url: string): Promise<AppState | null> {
  const result = await pool.query(
    `SELECT url, content_hash, pending_content_hash, consecutive_failures, consecutive_slow, last_status, updated_at
     FROM backcheck_app_state
     WHERE url = $1`,
    [url]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0] as AppState;
}

export async function updateAppState(
  url: string,
  updates: {
    contentHash?: string;
    pendingContentHash?: string | null;
    consecutiveFailures?: number;
    consecutiveSlow?: number;
    lastStatus?: string;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO backcheck_app_state (url, content_hash, pending_content_hash, consecutive_failures, consecutive_slow, last_status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (url)
     DO UPDATE SET
       content_hash = COALESCE($2, backcheck_app_state.content_hash),
       pending_content_hash = $3,
       consecutive_failures = COALESCE($4, backcheck_app_state.consecutive_failures),
       consecutive_slow = COALESCE($5, backcheck_app_state.consecutive_slow),
       last_status = COALESCE($6, backcheck_app_state.last_status),
       updated_at = NOW()`,
    [
      url,
      updates.contentHash ?? null,
      updates.pendingContentHash ?? null,
      updates.consecutiveFailures ?? null,
      updates.consecutiveSlow ?? null,
      updates.lastStatus ?? null,
    ]
  );
}

export interface PulseState {
  total_checks: number;
  total_issues: number;
  total_down: number;
  week_start: Date;
  last_pulse_sent: Date;
}

export async function getPulseState(): Promise<PulseState> {
  const result = await pool.query(
    `SELECT total_checks, total_issues, total_down, week_start, last_pulse_sent FROM backcheck_pulse WHERE id = 1`
  );
  if (result.rows.length === 0) {
    await pool.query(
      `INSERT INTO backcheck_pulse (id, total_checks, total_issues, total_down, week_start, last_pulse_sent)
       VALUES (1, 0, 0, 0, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`
    );
    return { total_checks: 0, total_issues: 0, total_down: 0, week_start: new Date(), last_pulse_sent: new Date() };
  }
  return result.rows[0] as PulseState;
}

export async function incrementPulseCounters(appsChecked: number, issueCount: number, downCount: number): Promise<void> {
  await pool.query(
    `UPDATE backcheck_pulse
     SET total_checks = total_checks + $1,
         total_issues = total_issues + $2,
         total_down = total_down + $3
     WHERE id = 1`,
    [appsChecked, issueCount, downCount]
  );
}

export async function resetPulseCounters(): Promise<void> {
  await pool.query(
    `UPDATE backcheck_pulse
     SET total_checks = 0,
         total_issues = 0,
         total_down = 0,
         week_start = NOW(),
         last_pulse_sent = NOW()
     WHERE id = 1`
  );
}

export async function isPulseDue(): Promise<boolean> {
  const state = await getPulseState();
  const daysSinceLastPulse = (Date.now() - new Date(state.last_pulse_sent).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceLastPulse >= 7;
}

const RUN_LOCK_STALE_MINUTES = 10;

export async function tryAcquireRunLock(runId: string): Promise<boolean> {
  await pool.query(
    `INSERT INTO backcheck_pulse (id, total_checks, total_issues, total_down, week_start, last_pulse_sent)
     VALUES (1, 0, 0, 0, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );

  const result = await pool.query(
    `UPDATE backcheck_pulse
     SET last_run_started_at = NOW(),
         last_run_completed_at = NULL,
         last_run_id = $1
     WHERE id = 1
       AND (
         last_run_started_at IS NULL
         OR last_run_completed_at IS NOT NULL
         OR last_run_started_at < NOW() - INTERVAL '${RUN_LOCK_STALE_MINUTES} minutes'
       )
     RETURNING last_run_id`,
    [runId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function releaseRunLock(runId: string): Promise<void> {
  await pool.query(
    `UPDATE backcheck_pulse
     SET last_run_completed_at = NOW()
     WHERE id = 1 AND last_run_id = $1`,
    [runId]
  );
}

// ============================================================================
// Notification Log — durable record of every outbound notification attempt
// ============================================================================

export interface NotificationLog {
  id: number;
  run_id: string | null;
  notification_type: string;
  subject: string | null;
  success: boolean;
  error: string | null;
  platform: string | null;
  attempted_at: Date;
}

let notificationLogTableReady = false;

async function ensureNotificationLogTable(): Promise<void> {
  if (notificationLogTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backcheck_notification_log (
      id SERIAL PRIMARY KEY,
      run_id TEXT,
      notification_type TEXT NOT NULL,
      subject TEXT,
      success BOOLEAN NOT NULL,
      error TEXT,
      platform TEXT,
      attempted_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  notificationLogTableReady = true;
}

export async function logNotification(params: {
  runId?: string;
  notificationType: "email" | "webhook";
  subject?: string;
  success: boolean;
  error?: string;
  platform?: string;
}): Promise<void> {
  await ensureNotificationLogTable();
  await pool.query(
    `INSERT INTO backcheck_notification_log
       (run_id, notification_type, subject, success, error, platform, attempted_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      params.runId ?? null,
      params.notificationType,
      params.subject ?? null,
      params.success,
      params.error ?? null,
      params.platform ?? null,
    ]
  );
}

export async function getRecentNotifications(limit = 20): Promise<NotificationLog[]> {
  await ensureNotificationLogTable();
  const result = await pool.query(
    `SELECT id, run_id, notification_type, subject, success, error, platform, attempted_at
     FROM backcheck_notification_log
     ORDER BY attempted_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows as NotificationLog[];
}

// ============================================================================
// Run Log — per-run business-level outcome tracking
// ============================================================================

export interface RunLog {
  id: number;
  run_id: string | null;
  apps_checked: number;
  apps_healthy: number;
  apps_down: number;
  apps_issues: number;
  notification_sent: boolean | null;
  notification_error: string | null;
  completed_at: Date;
}

let runLogTableReady = false;

async function ensureRunLogTable(): Promise<void> {
  if (runLogTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backcheck_run_log (
      id SERIAL PRIMARY KEY,
      run_id TEXT,
      apps_checked INTEGER NOT NULL DEFAULT 0,
      apps_healthy INTEGER NOT NULL DEFAULT 0,
      apps_down INTEGER NOT NULL DEFAULT 0,
      apps_issues INTEGER NOT NULL DEFAULT 0,
      notification_sent BOOLEAN,
      notification_error TEXT,
      completed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  runLogTableReady = true;
}

export async function logRunOutcome(params: {
  runId?: string;
  appsChecked: number;
  appsHealthy: number;
  appsDown: number;
  appsIssues: number;
  notificationSent?: boolean;
  notificationError?: string;
}): Promise<void> {
  await ensureRunLogTable();
  await pool.query(
    `INSERT INTO backcheck_run_log
       (run_id, apps_checked, apps_healthy, apps_down, apps_issues,
        notification_sent, notification_error, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      params.runId ?? null,
      params.appsChecked,
      params.appsHealthy,
      params.appsDown,
      params.appsIssues,
      params.notificationSent ?? null,
      params.notificationError ?? null,
    ]
  );
}

export async function getRecentRuns(limit = 10): Promise<RunLog[]> {
  await ensureRunLogTable();
  const result = await pool.query(
    `SELECT id, run_id, apps_checked, apps_healthy, apps_down, apps_issues,
            notification_sent, notification_error, completed_at
     FROM backcheck_run_log
     ORDER BY completed_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows as RunLog[];
}
