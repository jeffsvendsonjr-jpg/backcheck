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
