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
  biotics: z.array(z.string()).optional(),
  bioticsMissing: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  warningsFound: z.array(z.string()).optional(),
  hasIssues: z.boolean().optional(),
});

const collectAppUrls = createStep({
  id: "collect-app-pay-urls",
  description: "Collects all published app URLs from the APP_URLS environment variable",

  inputSchema: z.object({}).optional(),

  outputSchema: z.array(
    z.object({
      url: z.string(),
      name: z.string(),
      biotics: z.array(z.string()).optional(),
      warnings: z.array(z.string()).optional(),
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

      let name: string;
      let url: string;
      let biotics: string[] = [];
      let warnings: string[] = [];

      if (parts.length >= 3) {
        name = parts[0];
        url = parts[1];
        const words = parts[2].split(";").map((w) => w.trim()).filter((w) => w.length > 0);
        for (const word of words) {
          if (word.startsWith("+")) {
            biotics.push(word.slice(1));
          } else if (word.startsWith("-")) {
            warnings.push(word.slice(1));
          } else {
            warnings.push(word);
          }
        }
      } else if (parts.length === 2) {
        name = parts[0];
        url = parts[1];
      } else {
        url = entry;
        const urlObj = new URL(entry);
        name = urlObj.hostname.replace(".replit.app", "").replace(/[.-]/g, " ");
      }

      const result: any = { name, url };
      if (biotics.length > 0) result.biotics = biotics;
      if (warnings.length > 0) result.warnings = warnings;
      return result;
    });

    logger?.info(`✅ [collectAppUrls] Found ${apps.length} app(s) to monitor:`, {
      apps: apps.map((a: any) => {
        let desc = `${a.name} (${a.url})`;
        if (a.biotics?.length) desc += ` [biotics: ${a.biotics.map((w: string) => `"${w}"`).join(", ")}]`;
        if (a.warnings?.length) desc += ` [warnings: ${a.warnings.map((w: string) => `"${w}"`).join(", ")}]`;
        return desc;
      }),
    });

    return apps;
  },
});

const verifyAppLiveness = createStep({
  id: "verify-app-liveness",
  description: "Checks a single app URL for live status, scans for biotics (healthy signals) and warnings (bad signals)",

  inputSchema: z.object({
    url: z.string(),
    name: z.string(),
    biotics: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
  }),

  outputSchema: appResultSchema,

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const bioticsList = inputData.biotics || [];
    const warningsList = inputData.warnings || [];
    const hasScanWords = bioticsList.length > 0 || warningsList.length > 0;

    logger?.info(`🔍 [verifyAppLiveness] Checking: ${inputData.name} (${inputData.url})${bioticsList.length ? ` | biotics (+): ${bioticsList.map((w) => `"${w}"`).join(", ")}` : ""}${warningsList.length ? ` | warnings (-): ${warningsList.map((w) => `"${w}"`).join(", ")}` : ""}`);

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

      const bioticsMissing: string[] = [];
      const warningsFound: string[] = [];

      if (hasScanWords && isLive) {
        try {
          const body = await resp.text();
          const bodyLower = body.toLowerCase();

          for (const word of bioticsList) {
            if (!bodyLower.includes(word.toLowerCase())) {
              bioticsMissing.push(word);
              logger?.warn(
                `🦠 [verifyAppLiveness] ${inputData.name}: Biotic "${word}" MISSING from response body!`
              );
            } else {
              logger?.info(
                `🌿 [verifyAppLiveness] ${inputData.name}: Biotic "${word}" confirmed present`
              );
            }
          }

          for (const word of warningsList) {
            if (bodyLower.includes(word.toLowerCase())) {
              warningsFound.push(word);
              logger?.warn(
                `⚠️ [verifyAppLiveness] ${inputData.name}: Warning word "${word}" FOUND in response body!`
              );
            }
          }
        } catch (e) {
          logger?.warn(`⚠️ [verifyAppLiveness] ${inputData.name}: Could not read response body for content scan`);
        }
      }

      const hasIssues = bioticsMissing.length > 0 || warningsFound.length > 0;

      const icon = !isLive ? "❌" : hasIssues ? "⚠️" : "✅";
      let statusMsg = `${icon} [verifyAppLiveness] ${inputData.name}: status=${resp.status}, time=${responseTimeMs}ms`;
      if (bioticsMissing.length > 0) statusMsg += `, missing biotics: ${bioticsMissing.map((w) => `"${w}"`).join(", ")}`;
      if (warningsFound.length > 0) statusMsg += `, warnings found: ${warningsFound.map((w) => `"${w}"`).join(", ")}`;
      logger?.info(statusMsg);

      return {
        url: inputData.url,
        name: inputData.name,
        isLive: isLive && !hasIssues,
        statusCode: resp.status,
        responseTimeMs,
        checkedAt: new Date().toISOString(),
        biotics: bioticsList,
        bioticsMissing,
        warnings: warningsList,
        warningsFound,
        hasIssues,
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
        biotics: bioticsList,
        bioticsMissing: [],
        warnings: warningsList,
        warningsFound: [],
        hasIssues: false,
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
    issueApps: z.array(appResultSchema),
    hasProblems: z.boolean(),
    reportTimestamp: z.string(),
    summaryText: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(`📊 [compileReport] Compiling report for ${inputData.length} app(s)...`);

    const issueApps = inputData.filter((app) => app.hasIssues === true);
    const nonLiveApps = inputData.filter((app) => !app.isLive && !app.hasIssues);
    const liveApps = inputData.filter((app) => app.isLive && !app.hasIssues);

    const summaryLines = [
      `App Monitor Report - ${new Date().toISOString()}`,
      `Total: ${inputData.length} | Healthy: ${liveApps.length} | Down: ${nonLiveApps.length} | Issues: ${issueApps.length}`,
      "",
    ];

    if (nonLiveApps.length > 0) {
      summaryLines.push("DOWN APPS:");
      nonLiveApps.forEach((app) => {
        summaryLines.push(`  - ${app.name} (${app.url}): status=${app.statusCode}${app.error ? `, error: ${app.error}` : ""}`);
      });
      summaryLines.push("");
    }

    if (issueApps.length > 0) {
      summaryLines.push("ISSUE APPS (content scan triggered):");
      issueApps.forEach((app) => {
        const parts: string[] = [];
        if ((app.bioticsMissing?.length ?? 0) > 0) {
          parts.push(`missing biotics: ${app.bioticsMissing!.map((w) => `"${w}"`).join(", ")}`);
        }
        if ((app.warningsFound?.length ?? 0) > 0) {
          parts.push(`warning words found: ${app.warningsFound!.map((w) => `"${w}"`).join(", ")}`);
        }
        summaryLines.push(`  - ${app.name} (${app.url}): status=${app.statusCode}, ${parts.join(" | ")}`);
      });
      summaryLines.push("");
    }

    if (liveApps.length > 0) {
      summaryLines.push("HEALTHY APPS:");
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
      issueApps,
      hasProblems: nonLiveApps.length > 0 || issueApps.length > 0,
      reportTimestamp: new Date().toISOString(),
      summaryText,
    };
  },
});

const reportSchema = z.object({
  totalApps: z.number(),
  liveApps: z.array(appResultSchema),
  nonLiveApps: z.array(appResultSchema),
  issueApps: z.array(appResultSchema),
  hasProblems: z.boolean(),
  reportTimestamp: z.string(),
  summaryText: z.string(),
});

const notifyNonLiveApps = createStep({
  id: "notify-non-live-apps",
  description: "Sends an urgent email notification about apps that are down or have content issues",

  inputSchema: reportSchema,

  outputSchema: z.object({
    notified: z.boolean(),
    message: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(`🚨 [notifyNonLive] ${inputData.nonLiveApps.length} app(s) down, ${inputData.issueApps.length} issue(s)! Sending alert...`);

    const downSection = inputData.nonLiveApps.length > 0
      ? `\nDOWN apps:\n${inputData.nonLiveApps.map((app) => `- ${app.name} (${app.url}): HTTP ${app.statusCode}${app.error ? `, Error: ${app.error}` : ""}`).join("\n")}`
      : "";

    const issueLines: string[] = [];
    for (const app of inputData.issueApps) {
      let detail = `- ${app.name} (${app.url}): HTTP ${app.statusCode}`;
      if ((app.bioticsMissing?.length ?? 0) > 0) {
        detail += `\n  Missing healthy signals (biotics): ${app.bioticsMissing!.map((w) => `"${w}"`).join(", ")} — these words SHOULD be on the page but are NOT`;
      }
      if ((app.warningsFound?.length ?? 0) > 0) {
        detail += `\n  Warning words detected: ${app.warningsFound!.map((w) => `"${w}"`).join(", ")} — these words SHOULD NOT be on the page but ARE`;
      }
      issueLines.push(detail);
    }
    const issueSection = issueLines.length > 0
      ? `\nISSUE apps (content scan triggered):\n${issueLines.join("\n")}`
      : "";

    const liveSection = inputData.liveApps.length > 0
      ? `\nHEALTHY apps:\n${inputData.liveApps.map((app) => `- ${app.name} (${app.url}): HTTP ${app.statusCode}, ${app.responseTimeMs}ms`).join("\n")}`
      : "";

    const subjectParts = [];
    if (inputData.nonLiveApps.length > 0) subjectParts.push(`${inputData.nonLiveApps.length} Down`);
    if (inputData.issueApps.length > 0) subjectParts.push(`${inputData.issueApps.length} Issue(s)`);
    const subject = `ALERT: ${subjectParts.join(", ")}`;

    const response = await monitorAgent.generateLegacy(
      [
        {
          role: "user",
          content: `URGENT: Some of my published apps need attention! Send me an email notification.

Here is the monitoring report:
- Total apps checked: ${inputData.totalApps}
- Apps that are DOWN: ${inputData.nonLiveApps.length}
- Apps with ISSUES: ${inputData.issueApps.length}
- Apps that are HEALTHY: ${inputData.liveApps.length}
${downSection}${issueSection}${liveSection}

Send an email with subject "${subject}" using the send-email-notification tool.
Include a professional HTML email with:
- Red highlighting for down apps
- Orange/yellow highlighting for issue apps. Clearly explain:
  - "Missing biotics" means healthy signals that SHOULD appear on the page but are ABSENT (like a vital sign going flat)
  - "Warning words" means bad signals that SHOULD NOT appear on the page but WERE FOUND
- Green for healthy apps
Include the timestamp: ${inputData.reportTimestamp}`,
        },
      ],
      { maxSteps: 3 }
    );

    logger?.info(`✅ [notifyNonLive] Alert notification sent`);

    return {
      notified: true,
      message: `Alert sent: ${inputData.nonLiveApps.length} down, ${inputData.issueApps.length} issue(s)`,
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
- All apps are HEALTHY (all biotics confirmed present, no warning words detected)

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
      async ({ inputData }: any) => inputData.hasProblems === true,
      notifyNonLiveApps as any,
    ],
    [
      async ({ inputData }: any) => inputData.hasProblems === false,
      confirmAllAppsLive as any,
    ],
  ])
  .commit();
