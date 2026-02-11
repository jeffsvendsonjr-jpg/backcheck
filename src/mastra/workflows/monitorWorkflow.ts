import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { monitorAgent } from "../agents/monitorAgent";

const appResultSchema = z.object({
  url: z.string(),
  name: z.string(),
  isLive: z.boolean(),
  statusCode: z.number(),
  responseTimeMs: z.number(),
  error: z.string().optional(),
  checkedAt: z.string(),
  watchWords: z.array(z.string()).optional(),
  watchWordsFound: z.array(z.string()).optional(),
});

const collectAppUrls = createStep({
  id: "collect-app-pay-urls",
  description: "Collects all published app URLs from the APP_URLS environment variable",

  inputSchema: z.object({}).optional(),

  outputSchema: z.array(
    z.object({
      url: z.string(),
      name: z.string(),
      watchWords: z.array(z.string()).optional(),
    })
  ),

  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📋 [collectAppUrls] Collecting app URLs from environment...");

    const rawUrls = process.env.APP_URLS || "";

    if (!rawUrls.trim()) {
      logger?.warn("⚠️ [collectAppUrls] No APP_URLS environment variable set. Nothing to monitor.");
      return [];
    }

    const entries = rawUrls
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const apps = entries.map((entry) => {
      const parts = entry.split("|").map((s) => s.trim());
      if (parts.length >= 3) {
        const watchWords = parts[2].split(";").map((w) => w.trim()).filter((w) => w.length > 0);
        return { name: parts[0], url: parts[1], watchWords };
      } else if (parts.length === 2) {
        return { name: parts[0], url: parts[1] };
      }
      const urlObj = new URL(entry);
      const name = urlObj.hostname.replace(".replit.app", "").replace(/[.-]/g, " ");
      return { name, url: entry };
    });

    logger?.info(`✅ [collectAppUrls] Found ${apps.length} app(s) to monitor:`, {
      apps: apps.map((a) => `${a.name} (${a.url})${a.watchWords?.length ? ` [watching for: ${a.watchWords.map((w) => `"${w}"`).join(", ")}]` : ""}`),
    });

    return apps;
  },
});

const verifyAppLiveness = createStep({
  id: "verify-app-liveness",
  description: "Checks a single app URL for live status and scans for watch words in the response",

  inputSchema: z.object({
    url: z.string(),
    name: z.string(),
    watchWords: z.array(z.string()).optional(),
  }),

  outputSchema: appResultSchema,

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const watchList = inputData.watchWords || [];
    logger?.info(`🔍 [verifyAppLiveness] Checking: ${inputData.name} (${inputData.url})${watchList.length ? ` | watch words: ${watchList.map((w) => `"${w}"`).join(", ")}` : ""}`);

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(inputData.url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "ReplitAppMonitor/1.0" },
      });

      clearTimeout(timeout);
      const responseTimeMs = Date.now() - startTime;
      const isLive = resp.status >= 200 && resp.status < 400;

      const watchWordsFound: string[] = [];
      if (watchList.length > 0 && isLive) {
        try {
          const body = await resp.text();
          const bodyLower = body.toLowerCase();
          for (const word of watchList) {
            if (bodyLower.includes(word.toLowerCase())) {
              watchWordsFound.push(word);
              logger?.warn(
                `⚠️ [verifyAppLiveness] ${inputData.name}: Watch word "${word}" FOUND in response body!`
              );
            }
          }
        } catch (e) {
          logger?.warn(`⚠️ [verifyAppLiveness] ${inputData.name}: Could not read response body for watch word check`);
        }
      }

      const hasWarnings = watchWordsFound.length > 0;

      logger?.info(
        `${isLive && !hasWarnings ? "✅" : isLive && hasWarnings ? "⚠️" : "❌"} [verifyAppLiveness] ${inputData.name}: status=${resp.status}, time=${responseTimeMs}ms${hasWarnings ? `, watch words found: ${watchWordsFound.map((w) => `"${w}"`).join(", ")}` : ""}`
      );

      return {
        url: inputData.url,
        name: inputData.name,
        isLive: isLive && !hasWarnings,
        statusCode: resp.status,
        responseTimeMs,
        checkedAt: new Date().toISOString(),
        watchWords: watchList,
        watchWordsFound,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger?.error(`❌ [verifyAppLiveness] ${inputData.name}: Failed - ${errorMessage}`);

      return {
        url: inputData.url,
        name: inputData.name,
        isLive: false,
        statusCode: 0,
        responseTimeMs,
        error: errorMessage,
        checkedAt: new Date().toISOString(),
        watchWords: watchList,
        watchWordsFound: [],
      };
    }
  },
});

const compileVerificationReport = createStep({
  id: "compile-verification-report",
  description: "Compiles the results of all app liveness checks into a structured report",

  inputSchema: z.array(appResultSchema),

  outputSchema: z.object({
    totalApps: z.number(),
    liveApps: z.array(appResultSchema),
    nonLiveApps: z.array(appResultSchema),
    warningApps: z.array(appResultSchema),
    hasNonLiveApps: z.boolean(),
    hasWarnings: z.boolean(),
    reportTimestamp: z.string(),
    summaryText: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(`📊 [compileReport] Compiling report for ${inputData.length} app(s)...`);

    const warningApps = inputData.filter((app) => (app.watchWordsFound?.length ?? 0) > 0);
    const nonLiveApps = inputData.filter((app) => !app.isLive && (app.watchWordsFound?.length ?? 0) === 0);
    const liveApps = inputData.filter((app) => app.isLive && (app.watchWordsFound?.length ?? 0) === 0);

    const summaryLines = [
      `App Monitor Report - ${new Date().toISOString()}`,
      `Total: ${inputData.length} | Live: ${liveApps.length} | Down: ${nonLiveApps.length} | Warnings: ${warningApps.length}`,
      "",
    ];

    if (nonLiveApps.length > 0) {
      summaryLines.push("DOWN APPS:");
      nonLiveApps.forEach((app) => {
        summaryLines.push(`  - ${app.name} (${app.url}): status=${app.statusCode}${app.error ? `, error: ${app.error}` : ""}`);
      });
      summaryLines.push("");
    }

    if (warningApps.length > 0) {
      summaryLines.push("WARNING APPS (watch word detected):");
      warningApps.forEach((app) => {
        summaryLines.push(`  - ${app.name} (${app.url}): status=${app.statusCode}, watch words found: ${(app.watchWordsFound || []).map((w) => `"${w}"`).join(", ")}`);
      });
      summaryLines.push("");
    }

    if (liveApps.length > 0) {
      summaryLines.push("LIVE APPS:");
      liveApps.forEach((app) => {
        summaryLines.push(`  - ${app.name} (${app.url}): status=${app.statusCode}, ${app.responseTimeMs}ms`);
      });
    }

    const summaryText = summaryLines.join("\n");

    logger?.info(`📊 [compileReport] Report compiled:`, { summaryText });

    return {
      totalApps: inputData.length,
      liveApps,
      nonLiveApps,
      warningApps,
      hasNonLiveApps: nonLiveApps.length > 0 || warningApps.length > 0,
      hasWarnings: warningApps.length > 0,
      reportTimestamp: new Date().toISOString(),
      summaryText,
    };
  },
});

const reportSchema = z.object({
  totalApps: z.number(),
  liveApps: z.array(appResultSchema),
  nonLiveApps: z.array(appResultSchema),
  warningApps: z.array(appResultSchema),
  hasNonLiveApps: z.boolean(),
  hasWarnings: z.boolean(),
  reportTimestamp: z.string(),
  summaryText: z.string(),
});

const notifyNonLiveApps = createStep({
  id: "notify-non-live-apps",
  description: "Sends an urgent email notification about apps that are down or have watch word warnings",

  inputSchema: reportSchema,

  outputSchema: z.object({
    notified: z.boolean(),
    message: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(`🚨 [notifyNonLive] ${inputData.nonLiveApps.length} app(s) down, ${inputData.warningApps.length} warning(s)! Sending alert...`);

    const downSection = inputData.nonLiveApps.length > 0
      ? `\nDOWN apps:\n${inputData.nonLiveApps.map((app) => `- ${app.name} (${app.url}): HTTP ${app.statusCode}${app.error ? `, Error: ${app.error}` : ""}`).join("\n")}`
      : "";

    const warningSection = inputData.warningApps.length > 0
      ? `\nWARNING apps (watch words detected in page content):\n${inputData.warningApps.map((app) => `- ${app.name} (${app.url}): HTTP ${app.statusCode}, watch words found: ${(app.watchWordsFound || []).map((w) => `"${w}"`).join(", ")}`).join("\n")}`
      : "";

    const liveSection = inputData.liveApps.length > 0
      ? `\nLIVE apps:\n${inputData.liveApps.map((app) => `- ${app.name} (${app.url}): HTTP ${app.statusCode}, ${app.responseTimeMs}ms`).join("\n")}`
      : "";

    const issueCount = inputData.nonLiveApps.length + inputData.warningApps.length;
    const subjectParts = [];
    if (inputData.nonLiveApps.length > 0) subjectParts.push(`${inputData.nonLiveApps.length} Down`);
    if (inputData.warningApps.length > 0) subjectParts.push(`${inputData.warningApps.length} Warning(s)`);
    const subject = `ALERT: ${subjectParts.join(", ")}`;

    const response = await monitorAgent.generateLegacy(
      [
        {
          role: "user",
          content: `URGENT: Some of my published apps need attention! Send me an email notification.

Here is the monitoring report:
- Total apps checked: ${inputData.totalApps}
- Apps that are DOWN: ${inputData.nonLiveApps.length}
- Apps with WARNINGS: ${inputData.warningApps.length}
- Apps that are LIVE: ${inputData.liveApps.length}
${downSection}${warningSection}${liveSection}

Send an email with subject "${subject}" using the send-email-notification tool.
Include a professional HTML email with:
- Red highlighting for down apps
- Orange/yellow highlighting for warning apps (where a watch word was detected in the page content even though the app returned a success status)
- Green for live apps
Include the timestamp: ${inputData.reportTimestamp}`,
        },
      ],
      { maxSteps: 3 }
    );

    logger?.info(`✅ [notifyNonLive] Alert notification sent`);

    return {
      notified: true,
      message: `Alert sent: ${inputData.nonLiveApps.length} down, ${inputData.warningApps.length} warning(s)`,
    };
  },
});

const confirmAllAppsLive = createStep({
  id: "confirm-all-apps-live",
  description: "Sends a confirmation email that all monitored apps are live and healthy",

  inputSchema: reportSchema,

  outputSchema: z.object({
    notified: z.boolean(),
    message: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(`✅ [confirmAllLive] All ${inputData.totalApps} app(s) are live! Sending confirmation...`);

    const response = await monitorAgent.generateLegacy(
      [
        {
          role: "user",
          content: `Great news! All my published apps are live and healthy. Send me a confirmation email.

Here is the monitoring report:
- Total apps checked: ${inputData.totalApps}
- All apps are LIVE

App details:
${inputData.liveApps.map((app) => `- ${app.name} (${app.url}): HTTP ${app.statusCode}, response time: ${app.responseTimeMs}ms`).join("\n")}

Send an email with subject "All ${inputData.totalApps} App(s) Healthy" using the send-email-notification tool.
Include a brief, professional HTML email with green highlights confirming everything is healthy.
Include the timestamp: ${inputData.reportTimestamp}`,
        },
      ],
      { maxSteps: 3 }
    );

    logger?.info(`✅ [confirmAllLive] Confirmation notification sent`);

    return {
      notified: true,
      message: `All ${inputData.totalApps} apps confirmed live`,
    };
  },
});

export const monitorWorkflow = createWorkflow({
  id: "app-monitor-workflow",

  inputSchema: z.object({}).optional() as any,

  outputSchema: z.object({
    notified: z.boolean(),
    message: z.string(),
  }),
})
  .then(collectAppUrls as any)
  .foreach(verifyAppLiveness as any, { concurrency: 5 })
  .then(compileVerificationReport as any)
  .branch([
    [
      async ({ inputData }: any) => inputData.hasNonLiveApps === true,
      notifyNonLiveApps as any,
    ],
    [
      async ({ inputData }: any) => inputData.hasNonLiveApps === false,
      confirmAllAppsLive as any,
    ],
  ])
  .commit();
