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
