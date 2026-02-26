import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/mastra",
});

export const queryStatusTool = createTool({
  id: "query-app-status",
  description:
    "Queries the current monitoring status of all tracked apps from the database. Returns the last known state for each monitored URL including health status, consecutive failures, consecutive slow responses, content hash, and last update time. Also returns the weekly pulse summary and the current monitoring configuration.",

  inputSchema: z.object({
    includeConfig: z.boolean().optional().describe("Whether to include the current monitoring configuration (APP_URLS, schedule, notify mode). Defaults to true."),
  }),

  outputSchema: z.object({
    apps: z.array(z.object({
      url: z.string(),
      lastStatus: z.string().nullable(),
      consecutiveFailures: z.number(),
      consecutiveSlow: z.number(),
      contentHash: z.string().nullable(),
      updatedAt: z.string().nullable(),
    })),
    pulse: z.object({
      totalChecks: z.number(),
      totalIssues: z.number(),
      totalDown: z.number(),
      weekStart: z.string().nullable(),
      lastPulseSent: z.string().nullable(),
    }),
    config: z.object({
      appUrls: z.string(),
      schedule: z.string(),
      notifyMode: z.string(),
      sslWarnDays: z.string(),
      webhookConfigured: z.boolean(),
    }).optional(),
    queriedAt: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📊 [queryStatusTool] Querying current app monitoring status");

    try {
      const appResult = await pool.query(
        `SELECT url, last_status, consecutive_failures, consecutive_slow, content_hash, updated_at
         FROM backcheck_app_state
         ORDER BY url`
      );

      const apps = appResult.rows.map((row: any) => ({
        url: row.url,
        lastStatus: row.last_status,
        consecutiveFailures: row.consecutive_failures || 0,
        consecutiveSlow: row.consecutive_slow || 0,
        contentHash: row.content_hash,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      }));

      let pulse = { totalChecks: 0, totalIssues: 0, totalDown: 0, weekStart: null as string | null, lastPulseSent: null as string | null };
      try {
        const pulseResult = await pool.query(
          `SELECT total_checks, total_issues, total_down, week_start, last_pulse_sent FROM backcheck_pulse WHERE id = 1`
        );
        if (pulseResult.rows.length > 0) {
          const row = pulseResult.rows[0];
          pulse = {
            totalChecks: row.total_checks || 0,
            totalIssues: row.total_issues || 0,
            totalDown: row.total_down || 0,
            weekStart: row.week_start ? new Date(row.week_start).toISOString() : null,
            lastPulseSent: row.last_pulse_sent ? new Date(row.last_pulse_sent).toISOString() : null,
          };
        }
      } catch (e) {
        logger?.warn("📊 [queryStatusTool] Pulse table not available yet");
      }

      const includeConfig = context.includeConfig !== false;
      let config;
      if (includeConfig) {
        const appUrlsRaw = process.env.APP_URLS || "";
        const appNames = appUrlsRaw.split(",").map((entry: string) => {
          const parts = entry.trim().split("|");
          return parts.length > 1 ? parts[0].trim() : "(unnamed)";
        }).filter(Boolean);

        config = {
          appUrls: appNames.length > 0 ? `${appNames.length} apps configured: ${appNames.join(", ")}` : "(not configured)",
          schedule: process.env.SCHEDULE_CRON_EXPRESSION || "0 * * * * (default: every hour)",
          notifyMode: process.env.NOTIFY_MODE || "all (default)",
          sslWarnDays: process.env.SSL_WARN_DAYS || "14 (default)",
          webhookConfigured: !!process.env.WEBHOOK_URL,
        };
      }

      logger?.info(`📊 [queryStatusTool] Found ${apps.length} tracked apps, pulse: ${pulse.totalChecks} checks`);

      return {
        apps,
        pulse,
        config,
        queriedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger?.error(`❌ [queryStatusTool] Failed to query status: ${errorMessage}`);

      return {
        apps: [],
        pulse: { totalChecks: 0, totalIssues: 0, totalDown: 0, weekStart: null, lastPulseSent: null },
        queriedAt: new Date().toISOString(),
      };
    }
  },
});
