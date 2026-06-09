import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { safeFetchUrl } from "../../utils/urlSafety";

export const checkUrlTool = createTool({
  id: "check-url-liveness",
  description:
    "Checks if a given URL is live and accessible by making an HTTP GET request. Returns the HTTP status code, response time, and whether the app is considered live.",

  inputSchema: z.object({
    url: z.string().describe("The full URL to check (e.g. https://myapp.replit.app)"),
    name: z.string().optional().describe("A friendly name for the app being checked"),
  }),

  outputSchema: z.object({
    url: z.string(),
    name: z.string(),
    isLive: z.boolean(),
    statusCode: z.number(),
    responseTimeMs: z.number(),
    error: z.string().optional(),
    checkedAt: z.string(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    const url = context.url;
    const name = context.name || url;

    logger?.info(`🔍 [checkUrlTool] Checking liveness for: ${name} (${url})`);

    const startTime = Date.now();

    try {
      const { response, responseTimeMs } = await safeFetchUrl(url, {
        method: "GET",
        headers: {
          "User-Agent": "Backcheck/1.0",
        },
        timeoutMs: 15000,
      });

      const isLive = response.status >= 200 && response.status < 400;

      logger?.info(
        `${isLive ? "✅" : "❌"} [checkUrlTool] ${name}: status=${response.status}, time=${responseTimeMs}ms`
      );

      return {
        url,
        name,
        isLive,
        statusCode: response.status,
        responseTimeMs,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger?.error(
        `❌ [checkUrlTool] ${name}: Failed to reach - ${errorMessage}`
      );

      return {
        url,
        name,
        isLive: false,
        statusCode: 0,
        responseTimeMs,
        error: errorMessage,
        checkedAt: new Date().toISOString(),
      };
    }
  },
});
