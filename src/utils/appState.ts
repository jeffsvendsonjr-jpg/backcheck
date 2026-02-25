import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/mastra",
});

export interface AppState {
  url: string;
  content_hash: string | null;
  consecutive_failures: number;
  consecutive_slow: number;
  last_status: string | null;
  updated_at: Date;
}

export async function getAppState(url: string): Promise<AppState | null> {
  const result = await pool.query(
    `SELECT url, content_hash, consecutive_failures, consecutive_slow, last_status, updated_at
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
    consecutiveFailures?: number;
    consecutiveSlow?: number;
    lastStatus?: string;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO backcheck_app_state (url, content_hash, consecutive_failures, consecutive_slow, last_status, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (url)
     DO UPDATE SET
       content_hash = COALESCE($2, backcheck_app_state.content_hash),
       consecutive_failures = COALESCE($3, backcheck_app_state.consecutive_failures),
       consecutive_slow = COALESCE($4, backcheck_app_state.consecutive_slow),
       last_status = COALESCE($5, backcheck_app_state.last_status),
       updated_at = NOW()`,
    [
      url,
      updates.contentHash ?? null,
      updates.consecutiveFailures ?? null,
      updates.consecutiveSlow ?? null,
      updates.lastStatus ?? null,
    ]
  );
}
