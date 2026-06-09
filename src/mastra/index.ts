import { Mastra } from "@mastra/core";
import { MastraError } from "@mastra/core/error";
import { PinoLogger } from "@mastra/loggers";
import { LogLevel, MastraLogger } from "@mastra/core/logger";
import pino from "pino";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import { sharedPostgresStorage } from "./storage";
import { inngest, inngestServe } from "./inngest";

import { registerCronTrigger } from "../triggers/cronTriggers";
import { monitorAgent } from "./agents/monitorAgent";
import { monitorWorkflow } from "./workflows/monitorWorkflow";

registerCronTrigger({
  cronExpression: process.env.SCHEDULE_CRON_EXPRESSION || "0 * * * *",
  workflow: monitorWorkflow,
});

class ProductionPinoLogger extends MastraLogger {
  protected logger: pino.Logger;

  constructor(
    options: {
      name?: string;
      level?: LogLevel;
    } = {},
  ) {
    super(options);

    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label: string, _number: number) => ({
          level: label,
        }),
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    });
  }

  debug(message: string, args: Record<string, any> = {}): void {
    this.logger.debug(args, message);
  }

  info(message: string, args: Record<string, any> = {}): void {
    this.logger.info(args, message);
  }

  warn(message: string, args: Record<string, any> = {}): void {
    this.logger.warn(args, message);
  }

  error(message: string, args: Record<string, any> = {}): void {
    this.logger.error(args, message);
  }
}

export const mastra = new Mastra({
  storage: sharedPostgresStorage,
  workflows: { monitorWorkflow },
  agents: { monitorAgent },
  bundler: {
    // A few dependencies are not properly picked up by
    // the bundler if they are not added directly to the
    // entrypoint.
    externals: [
      "@slack/web-api",
      "inngest",
      "inngest/hono",
      "hono",
      "hono/streaming",
    ],
    // sourcemaps are good for debugging.
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    middleware: [
      async (c, next) => {
        const url = new URL(c.req.url);
        if (url.pathname === "/" || url.pathname === "/index.html") {
          const { getHomepageHtml } = await import("../homepage");
          return c.html(getHomepageHtml());
        }
        await next();
      },
      async (c, next) => {
        const url = new URL(c.req.url);
        const protectedPaths = ["/dashboard", "/api/test-failure"];
        const requiresAuth = protectedPaths.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"));
        const password = process.env.DASHBOARD_PASSWORD;
        if (requiresAuth && password) {
          const authHeader = c.req.header("authorization") || "";
          const expected = "Basic " + Buffer.from(`backcheck:${password}`).toString("base64");
          const crypto = await import("node:crypto");
          const a = Buffer.from(authHeader);
          const b = Buffer.from(expected);
          const matches = a.length === b.length && crypto.timingSafeEqual(a, b);
          if (!matches) {
            return c.body("Authentication required", 401, {
              "WWW-Authenticate": 'Basic realm="Backcheck Dashboard"',
            });
          }
        }
        await next();
      },
      async (c, next) => {
        const mastra = c.get("mastra");
        const logger = mastra?.getLogger();
        logger?.debug("[Request]", { method: c.req.method, url: c.req.url });
        try {
          await next();
        } catch (error) {
          logger?.error("[Response]", {
            method: c.req.method,
            url: c.req.url,
            error,
          });
          if (error instanceof MastraError) {
            if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
              // This is typically a non-retirable error. It means that the request was not
              // setup correctly to pass in the necessary parameters.
              throw new NonRetriableError(error.message, { cause: error });
            }
          } else if (error instanceof z.ZodError) {
            // Validation errors are never retriable.
            throw new NonRetriableError(error.message, { cause: error });
          }

          throw error;
        }
      },
    ],
    apiRoutes: [
      // ======================================================================
      // Inngest Integration Endpoint
      // ======================================================================
      // Integrates Mastra workflows with Inngest for event-driven execution via inngest functions.
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({ mastra }) => inngestServe({ mastra, inngest }),
      },

      {
        path: "/api/homepage",
        method: "GET",
        handler: async (c: any) => {
          const { getHomepageHtml } = await import("../homepage");
          return c.html(getHomepageHtml());
        },
      },
      {
        path: "/dashboard",
        method: "GET",
        handler: async (c: any) => {
          const { getDashboardHtml } = await import("../dashboard");
          return c.html(await getDashboardHtml());
        },
      },
      {
        path: "/api/test-failure",
        method: "POST",
        createHandler: async ({ mastra }: any) => {
          return async (c: any) => {
            const logger = mastra?.getLogger();
            logger?.info("🧪 [testFailure] Demo test-failure endpoint triggered");
            try {
              const { monitorWorkflow } = await import("./workflows/monitorWorkflow");
              const run = await mastra.getWorkflow("monitorWorkflow").createRunAsync();
              run.start({ inputData: {} });
              logger?.info("🧪 [testFailure] Demo workflow run started");
              return c.json({ success: true, message: "Test triggered. Backcheck is running a check now — check your email in ~30 seconds." });
            } catch (error: any) {
              logger?.error("🧪 [testFailure] Error", { error: error?.message });
              return c.json({ success: false, error: error?.message || "Failed to trigger test" }, 500);
            }
          };
        },
      },
      {
        path: "/api/status",
        method: "GET",
        handler: async (c: any) => {
          try {
            const { getRecentRuns, getRecentNotifications, getPulseState } = await import("../utils/appState");
            const [recentRuns, recentNotifications, pulseState] = await Promise.all([
              getRecentRuns(10).catch(() => []),
              getRecentNotifications(10).catch(() => []),
              getPulseState().catch(() => null),
            ]);

            const appUrlsRaw = process.env.APP_URLS || "";
            const monitoredCount = appUrlsRaw
              ? appUrlsRaw.split(",").map((e: string) => e.trim()).filter(Boolean).length
              : 0;

            const lastRun = recentRuns[0] ?? null;
            const notificationFailures = recentNotifications.filter((n: any) => !n.success).length;
            const notificationSuccesses = recentNotifications.filter((n: any) => n.success).length;

            return c.json({
              status: "ok",
              generatedAt: new Date().toISOString(),
              monitoring: {
                appsConfigured: monitoredCount,
                schedule: process.env.SCHEDULE_CRON_EXPRESSION || "0 * * * *",
                notifyMode: process.env.NOTIFY_MODE || "all",
              },
              lastRun: lastRun
                ? {
                    runId: lastRun.run_id,
                    completedAt: new Date(lastRun.completed_at).toISOString(),
                    appsChecked: lastRun.apps_checked,
                    appsHealthy: lastRun.apps_healthy,
                    appsDown: lastRun.apps_down,
                    appsIssues: lastRun.apps_issues,
                    notificationSent: lastRun.notification_sent,
                    notificationError: lastRun.notification_error,
                  }
                : null,
              notifications: {
                recentAttempts: recentNotifications.length,
                recentSuccesses: notificationSuccesses,
                recentFailures: notificationFailures,
                last10: recentNotifications.map((n: any) => ({
                  type: n.notification_type,
                  subject: n.subject,
                  success: n.success,
                  error: n.error,
                  platform: n.platform,
                  attemptedAt: new Date(n.attempted_at).toISOString(),
                })),
              },
              pulse: pulseState
                ? {
                    totalChecks: pulseState.total_checks,
                    totalIssues: pulseState.total_issues,
                    totalDown: pulseState.total_down,
                    weekStart: pulseState.week_start ? new Date(pulseState.week_start).toISOString() : null,
                    lastPulseSent: pulseState.last_pulse_sent ? new Date(pulseState.last_pulse_sent).toISOString() : null,
                  }
                : null,
              recentRuns: recentRuns.map((r: any) => ({
                runId: r.run_id,
                completedAt: new Date(r.completed_at).toISOString(),
                appsChecked: r.apps_checked,
                appsDown: r.apps_down,
                appsIssues: r.apps_issues,
                notificationSent: r.notification_sent,
                notificationError: r.notification_error,
              })),
            });
          } catch (error: any) {
            return c.json(
              { status: "error", error: error?.message || "Failed to query status", generatedAt: new Date().toISOString() },
              500
            );
          }
        },
      },
      {
        path: "/api/chat",
        method: "POST",
        createHandler: async ({ mastra }: any) => {
          return async (c: any) => {
            const logger = mastra?.getLogger();
            try {
              const body = await c.req.json();
              const { messages, threadId, resourceId } = body;

              if (!messages || !Array.isArray(messages) || messages.length === 0) {
                return c.json({ error: "Messages array is required" }, 400);
              }

              const agent = mastra.getAgent("monitorAgent");
              logger?.info("[Chat API] Generating response", { threadId, messageCount: messages.length });

              const sanitizedMessages = messages
                .filter((m: any) => m.role === "user")
                .map((m: any) => ({ role: "user" as const, content: String(m.content).slice(0, 2000) }));

              if (sanitizedMessages.length === 0) {
                return c.json({ error: "No valid user messages provided" }, 400);
              }

              const safeThreadId = threadId || ("anon-" + Date.now());
              const safeResourceId = resourceId || "web-visitor";

              const response = await agent.generateLegacy(sanitizedMessages, {
                maxSteps: 5,
                memory: { thread: safeThreadId, resource: safeResourceId },
                instructions: `You are in CHAT ASSISTANT MODE. You are helping a visitor understand Backcheck.
CRITICAL RULES FOR CHAT MODE:
- Do NOT call the send-email-notification tool under any circumstances
- Do NOT call the send-webhook-notification tool under any circumstances
- You may ONLY use the query-app-status tool and check-url-liveness tool
- Be helpful, concise, and conversational
- If asked to send emails or notifications, politely explain that is handled automatically by the monitoring system`,
              });

              logger?.info("[Chat API] Response generated successfully");
              return c.json({ text: response.text });
            } catch (error: any) {
              logger?.error("[Chat API] Error", { error: error?.message });
              return c.json({ error: "Failed to generate response", details: error?.message }, 500);
            }
          };
        },
      },
    ],
  },
  logger:
    process.env.NODE_ENV === "production"
      ? new ProductionPinoLogger({
          name: "Mastra",
          level: "info",
        })
      : new PinoLogger({
          name: "Mastra",
          level: "info",
        }),
});

/*  Sanity check 1: Throw an error if there are more than 1 workflows.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getWorkflows()).length > 1) {
  throw new Error(
    "More than 1 workflows found. Currently, more than 1 workflows are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}

/*  Sanity check 2: Throw an error if there are more than 1 agents.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getAgents()).length > 1) {
  throw new Error(
    "More than 1 agents found. Currently, more than 1 agents are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}
