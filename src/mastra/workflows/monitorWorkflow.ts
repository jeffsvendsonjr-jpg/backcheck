import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import * as tls from "node:tls";
import * as crypto from "node:crypto";
import { monitorAgent } from "../agents/monitorAgent";
import { getAppState, updateAppState, incrementPulseCounters, isPulseDue, getPulseState, resetPulseCounters, tryAcquireRunLock, releaseRunLock } from "../../utils/appState";

const CURRENT_RUN_ID = { value: "" };

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
  sslDaysRemaining: z.number().optional(),
  sslExpiring: z.boolean().optional(),
  contentChanged: z.boolean().optional(),
  consecutiveFailures: z.number().optional(),
  consecutiveSlow: z.number().optional(),
});

function normalizeContentForHashing(html: string): string {
  let normalized = html;
  normalized = normalized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  normalized = normalized.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  normalized = normalized.replace(/<!--[\s\S]*?-->/g, "");
  normalized = normalized.replace(/<script\s+type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "");
  normalized = normalized.replace(/<meta\b[^>]*(?:og:updated_time|last-modified|date|revised|modified)[^>]*>/gi, "");
  normalized = normalized.replace(/\b(csrf|nonce|token|_token|authenticity_token)\s*[:=]\s*["'][^"']*["']/gi, "");
  normalized = normalized.replace(/\b(csrf|nonce|token)["']?\s*:\s*["'][^"']*["']/gi, "");
  normalized = normalized.replace(/<(input|meta)[^>]*(csrf|nonce|token|_token)[^>]*>/gi, "");
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s"'<]*/g, "");
  normalized = normalized.replace(/\b\d{10,13}\b/g, "");
  normalized = normalized.replace(/[a-f0-9]{32,64}/gi, (match) => {
    if (/^[a-f0-9]+$/i.test(match) && match.length >= 32) return "";
    return match;
  });
  normalized = normalized.replace(/data-[\w-]+=["'][^"']*["']/gi, "");
  normalized = normalized.replace(/aria-[\w-]+=["'][^"']*["']/gi, "");
  normalized = normalized.replace(/\bid=["'][^"']*[a-f0-9]{8,}[^"']*["']/gi, "");
  normalized = normalized.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "");
  normalized = normalized.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  normalized = normalized.replace(/\s+/g, " ");
  normalized = normalized.trim();
  return normalized;
}

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

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const acquired = await tryAcquireRunLock(runId);
    if (!acquired) {
      logger?.warn(`🔒 [collectAppUrls] Another workflow run is already in progress. Skipping this run to prevent duplicate alerts.`);
      return [];
    }
    CURRENT_RUN_ID.value = runId;
    logger?.info(`🔓 [collectAppUrls] Run lock acquired: ${runId}`);

    const rawUrls = process.env.APP_URLS || "";

    if (!rawUrls.trim()) {
      logger?.warn("⚠️ [collectAppUrls] No APP_URLS environment variable set. Nothing to monitor.");
      await releaseRunLock(runId);
      return [];
    }

    const entries = rawUrls
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const apps: Array<{ name: string; url: string; biotics?: string[]; warnings?: string[] }> = [];

    for (const entry of entries) {
      try {
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
          try {
            const urlObj = new URL(entry);
            name = urlObj.hostname.replace(".replit.app", "").replace(/[.-]/g, " ");
          } catch {
            logger?.error(`❌ [collectAppUrls] Skipping malformed URL entry: "${entry}"`);
            continue;
          }
        }

        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          logger?.error(`❌ [collectAppUrls] Skipping entry with invalid URL (must start with http:// or https://): "${url}"`);
          continue;
        }

        const result: { name: string; url: string; biotics?: string[]; warnings?: string[] } = { name, url };
        if (biotics.length > 0) result.biotics = biotics;
        if (warnings.length > 0) result.warnings = warnings;
        apps.push(result);
      } catch (e) {
        logger?.error(`❌ [collectAppUrls] Skipping unparseable entry: "${entry}" - ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }

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
    const SLOW_THRESHOLD_MS = 5000;
    const CONSECUTIVE_SLOW_THRESHOLD = 2;
    const MAX_RETRIES = 1;

    logger?.info(`🔍 [verifyAppLiveness] Checking: ${inputData.name} (${inputData.url})${bioticsList.length ? ` | biotics (+): ${bioticsList.map((w) => `"${w}"`).join(", ")}` : ""}${warningsList.length ? ` | warnings (-): ${warningsList.map((w) => `"${w}"`).join(", ")}` : ""}`);

    const SSL_EXPIRY_WARNING_DAYS = parseInt(process.env.SSL_WARN_DAYS || "14", 10) || 14;

    let previousState = null as Awaited<ReturnType<typeof getAppState>>;
    try {
      previousState = await getAppState(inputData.url);
      if (previousState) {
        logger?.info(`📊 [verifyAppLiveness] ${inputData.name}: Previous state — failures: ${previousState.consecutive_failures}, slow: ${previousState.consecutive_slow}, has content hash: ${!!previousState.content_hash}`);
      }
    } catch (e) {
      logger?.warn(`⚠️ [verifyAppLiveness] ${inputData.name}: Could not read previous state: ${e instanceof Error ? e.message : String(e)}`);
    }

    async function attemptFetch(): Promise<{ resp: Response; responseTimeMs: number }> {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(inputData.url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Backcheck/1.0" },
      });

      clearTimeout(timeout);
      return { resp, responseTimeMs: Date.now() - startTime };
    }

    async function checkSslCert(urlStr: string): Promise<{ daysRemaining: number; expiring: boolean } | null> {
      try {
        const parsed = new URL(urlStr);
        if (parsed.protocol !== "https:") return null;

        const hostname = parsed.hostname;
        const port = parseInt(parsed.port) || 443;

        return await new Promise((resolve) => {
          const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: 5000 }, () => {
            const cert = socket.getPeerCertificate();
            socket.destroy();

            if (!cert || !cert.valid_to) {
              resolve(null);
              return;
            }

            const expiryDate = new Date(cert.valid_to);
            const now = new Date();
            const daysRemaining = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            resolve({ daysRemaining, expiring: daysRemaining <= SSL_EXPIRY_WARNING_DAYS });
          });

          socket.on("error", () => {
            socket.destroy();
            resolve(null);
          });

          socket.on("timeout", () => {
            socket.destroy();
            resolve(null);
          });
        });
      } catch {
        return null;
      }
    }

    let lastError: string | undefined;
    let lastResponseTimeMs = 0;
    const overallStartTime = Date.now();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const attemptStartTime = Date.now();
      try {
        if (attempt > 0) {
          logger?.info(`🔄 [verifyAppLiveness] ${inputData.name}: Retry attempt ${attempt}/${MAX_RETRIES} after initial failure...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        const { resp, responseTimeMs } = await attemptFetch();
        lastResponseTimeMs = responseTimeMs;
        const isLive = resp.status >= 200 && resp.status < 400;

        if (!isLive && attempt < MAX_RETRIES) {
          logger?.warn(`⚠️ [verifyAppLiveness] ${inputData.name}: Got status ${resp.status}, will retry to confirm...`);
          lastError = `HTTP ${resp.status}`;
          continue;
        }

        const bioticsMissing: string[] = [];
        const warningsFound: string[] = [];
        const isCurrentlySlow = responseTimeMs > SLOW_THRESHOLD_MS;

        let contentChanged = false;
        let contentHash: string | undefined;
        let bodyText = "";

        if (isLive) {
          try {
            bodyText = await resp.text();
            const bodyLower = bodyText.toLowerCase();

            const normalizedBody = normalizeContentForHashing(bodyText);
            contentHash = crypto.createHash("md5").update(normalizedBody).digest("hex");

            if (previousState?.content_hash && previousState.content_hash !== contentHash) {
              if (previousState.pending_content_hash && previousState.pending_content_hash === contentHash) {
                contentChanged = true;
                logger?.warn(`🔄 [verifyAppLiveness] ${inputData.name}: Page content has CHANGED (confirmed across 2 consecutive checks)`);
              } else {
                logger?.info(`🔄 [verifyAppLiveness] ${inputData.name}: Content hash differs — storing as pending, will confirm on next check (hash: ${contentHash.slice(0, 8)}...)`);
              }
            } else if (!previousState?.content_hash) {
              logger?.info(`📝 [verifyAppLiveness] ${inputData.name}: First content hash recorded: ${contentHash.slice(0, 8)}...`);
            } else {
              logger?.info(`✅ [verifyAppLiveness] ${inputData.name}: Content unchanged (hash: ${contentHash.slice(0, 8)}...)`);
            }

            if (hasScanWords) {
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
            }
          } catch (e) {
            logger?.warn(`⚠️ [verifyAppLiveness] ${inputData.name}: Could not read response body for content scan`);
          }
        }

        const prevConsecutiveSlow = previousState?.consecutive_slow ?? 0;
        const newConsecutiveSlow = isCurrentlySlow ? prevConsecutiveSlow + 1 : 0;
        const isSlow = newConsecutiveSlow >= CONSECUTIVE_SLOW_THRESHOLD;

        if (isCurrentlySlow && !isSlow) {
          logger?.info(`🐢 [verifyAppLiveness] ${inputData.name}: Slow response (${responseTimeMs}ms) but only ${newConsecutiveSlow}/${CONSECUTIVE_SLOW_THRESHOLD} consecutive — not flagging yet`);
        } else if (isSlow) {
          logger?.warn(`🐢 [verifyAppLiveness] ${inputData.name}: Slow response ${responseTimeMs}ms — ${newConsecutiveSlow} consecutive slow checks (threshold: ${CONSECUTIVE_SLOW_THRESHOLD})`);
        }

        let sslDaysRemaining: number | undefined;
        let sslExpiring = false;

        const sslResult = await checkSslCert(inputData.url);
        if (sslResult) {
          sslDaysRemaining = sslResult.daysRemaining;
          sslExpiring = sslResult.expiring;
          if (sslExpiring) {
            logger?.warn(`🔐 [verifyAppLiveness] ${inputData.name}: SSL certificate expires in ${sslDaysRemaining} day(s)!`);
          } else {
            logger?.info(`🔒 [verifyAppLiveness] ${inputData.name}: SSL certificate valid for ${sslDaysRemaining} day(s)`);
          }
        }

        const hasIssues = bioticsMissing.length > 0 || warningsFound.length > 0 || isSlow || sslExpiring || contentChanged;

        const newConsecutiveFailures = (isLive && !hasIssues) ? 0 : (previousState?.consecutive_failures ?? 0) + 1;

        const isFirstHash = contentHash && !previousState?.content_hash;
        const pendingHash = (() => {
          if (!contentHash || !previousState?.content_hash) return null;
          if (previousState.content_hash === contentHash) return null;
          if (contentChanged) return null;
          return contentHash;
        })();

        try {
          await updateAppState(inputData.url, {
            contentHash: (contentChanged || isFirstHash) ? contentHash : undefined,
            pendingContentHash: pendingHash,
            consecutiveFailures: isLive ? (hasIssues ? newConsecutiveFailures : 0) : newConsecutiveFailures,
            consecutiveSlow: newConsecutiveSlow,
            lastStatus: isLive ? (hasIssues ? "issues" : "healthy") : "down",
          });
        } catch (e) {
          logger?.warn(`⚠️ [verifyAppLiveness] ${inputData.name}: Could not update state: ${e instanceof Error ? e.message : String(e)}`);
        }

        const icon = !isLive ? "❌" : hasIssues ? "⚠️" : "✅";
        let statusMsg = `${icon} [verifyAppLiveness] ${inputData.name}: status=${resp.status}, time=${responseTimeMs}ms`;
        if (bioticsMissing.length > 0) statusMsg += `, missing biotics: ${bioticsMissing.map((w) => `"${w}"`).join(", ")}`;
        if (warningsFound.length > 0) statusMsg += `, warnings found: ${warningsFound.map((w) => `"${w}"`).join(", ")}`;
        if (isSlow) statusMsg += `, SLOW RESPONSE (${newConsecutiveSlow} consecutive)`;
        if (sslExpiring) statusMsg += `, SSL EXPIRING (${sslDaysRemaining}d)`;
        if (contentChanged) statusMsg += `, CONTENT CHANGED`;
        if (attempt > 0) statusMsg += ` (confirmed after retry)`;
        statusMsg += `, failures: ${newConsecutiveFailures}`;
        logger?.info(statusMsg);

        return {
          url: inputData.url,
          name: inputData.name,
          isLive,
          statusCode: resp.status,
          responseTimeMs,
          checkedAt: new Date().toISOString(),
          biotics: bioticsList,
          bioticsMissing,
          warnings: warningsList,
          warningsFound,
          hasIssues,
          sslDaysRemaining,
          sslExpiring,
          contentChanged,
          consecutiveFailures: newConsecutiveFailures,
          consecutiveSlow: newConsecutiveSlow,
        };
      } catch (error) {
        lastResponseTimeMs = Date.now() - attemptStartTime;
        lastError = error instanceof Error ? error.message : String(error);

        if (attempt < MAX_RETRIES) {
          logger?.warn(`⚠️ [verifyAppLiveness] ${inputData.name}: Request failed (${lastError}), will retry to confirm...`);
          continue;
        }

        const newConsecutiveFailures = (previousState?.consecutive_failures ?? 0) + 1;

        try {
          await updateAppState(inputData.url, {
            consecutiveFailures: newConsecutiveFailures,
            consecutiveSlow: 0,
            lastStatus: "down",
          });
        } catch (e) {
          logger?.warn(`⚠️ [verifyAppLiveness] ${inputData.name}: Could not update state: ${e instanceof Error ? e.message : String(e)}`);
        }

        logger?.error(`❌ [verifyAppLiveness] ${inputData.name}: Failed after ${attempt + 1} attempt(s) - ${lastError}, consecutive failures: ${newConsecutiveFailures}`);

        return {
          url: inputData.url,
          name: inputData.name,
          isLive: false,
          statusCode: 0,
          responseTimeMs: lastResponseTimeMs,
          error: lastError,
          checkedAt: new Date().toISOString(),
          biotics: bioticsList,
          bioticsMissing: [],
          warnings: warningsList,
          warningsFound: [],
          hasIssues: false,
          consecutiveFailures: newConsecutiveFailures,
        };
      }
    }

    const finalConsecutiveFailures = (previousState?.consecutive_failures ?? 0) + 1;

    try {
      await updateAppState(inputData.url, {
        consecutiveFailures: finalConsecutiveFailures,
        consecutiveSlow: 0,
        lastStatus: "down",
      });
    } catch (e) {
      logger?.warn(`⚠️ [verifyAppLiveness] ${inputData.name}: Could not update state: ${e instanceof Error ? e.message : String(e)}`);
    }

    return {
      url: inputData.url,
      name: inputData.name,
      isLive: false,
      statusCode: 0,
      responseTimeMs: Date.now() - overallStartTime,
      error: lastError || "Unknown failure after retries",
      checkedAt: new Date().toISOString(),
      biotics: bioticsList,
      bioticsMissing: [],
      warnings: warningsList,
      warningsFound: [],
      hasIssues: false,
      consecutiveFailures: finalConsecutiveFailures,
    };
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
    groupedFailure: z.boolean().optional(),
    alertTone: z.string().optional(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(`📊 [compileReport] Compiling report for ${inputData.length} app(s)...`);

    if (inputData.length === 0) {
      logger?.warn("⚠️ [compileReport] No apps configured — set APP_URLS to start monitoring. Skipping notification.");
      return {
        totalApps: 0,
        liveApps: [],
        nonLiveApps: [],
        issueApps: [],
        hasProblems: false,
        reportTimestamp: new Date().toISOString(),
        summaryText: "No apps configured. Set APP_URLS to start monitoring.",
      };
    }

    const nonLiveApps = inputData.filter((app) => !app.isLive);
    const issueApps = inputData.filter((app) => app.isLive && app.hasIssues === true);
    const liveApps = inputData.filter((app) => app.isLive && !app.hasIssues);

    const groupedFailure = nonLiveApps.length >= 2;
    if (groupedFailure) {
      logger?.warn(`🔗 [compileReport] ${nonLiveApps.length} apps failed simultaneously — possible shared dependency issue`);
    }

    const problemApps = [...nonLiveApps, ...issueApps];
    const maxConsecutiveFailures = Math.max(0, ...problemApps.map((a) => a.consecutiveFailures ?? 0));
    let alertTone: string;
    if (maxConsecutiveFailures <= 1) {
      alertTone = "calm";
    } else if (maxConsecutiveFailures <= 3) {
      alertTone = "urgent";
    } else {
      alertTone = "brief";
    }

    const summaryLines = [
      `Backcheck Report - ${new Date().toISOString()}`,
      `Total: ${inputData.length} | Healthy: ${liveApps.length} | Down: ${nonLiveApps.length} | Issues: ${issueApps.length}`,
      "",
    ];

    if (groupedFailure) {
      summaryLines.push("⚠️ GROUPED FAILURE: Multiple apps failed simultaneously — possible shared dependency issue");
      summaryLines.push("");
    }

    if (nonLiveApps.length > 0) {
      summaryLines.push("DOWN APPS:");
      nonLiveApps.forEach((app) => {
        let line = `  - ${app.name} (${app.url}): status=${app.statusCode}${app.error ? `, error: ${app.error}` : ""}`;
        if (app.consecutiveFailures && app.consecutiveFailures > 1) {
          line += ` (consecutive failure #${app.consecutiveFailures})`;
        }
        summaryLines.push(line);
      });
      summaryLines.push("");
    }

    if (issueApps.length > 0) {
      summaryLines.push("ISSUE APPS:");
      issueApps.forEach((app) => {
        const parts: string[] = [];
        if ((app.bioticsMissing?.length ?? 0) > 0) {
          parts.push(`missing biotics: ${app.bioticsMissing!.map((w) => `"${w}"`).join(", ")}`);
        }
        if ((app.warningsFound?.length ?? 0) > 0) {
          parts.push(`warning words found: ${app.warningsFound!.map((w) => `"${w}"`).join(", ")}`);
        }
        if ((app.consecutiveSlow ?? 0) >= 2) {
          parts.push(`slow response: ${app.responseTimeMs}ms (${app.consecutiveSlow} consecutive)`);
        }
        if (app.sslExpiring) {
          parts.push(`SSL cert expires in ${app.sslDaysRemaining} day(s)`);
        }
        if (app.contentChanged) {
          parts.push(`page content changed since last check`);
        }
        if (app.consecutiveFailures && app.consecutiveFailures > 1) {
          parts.push(`consecutive issue #${app.consecutiveFailures}`);
        }
        summaryLines.push(`  - ${app.name} (${app.url}): status=${app.statusCode}, ${parts.join(" | ")}`);
      });
      summaryLines.push("");
    }

    if (liveApps.length > 0) {
      summaryLines.push("HEALTHY APPS:");
      liveApps.forEach((app) => {
        let line = `  - ${app.name} (${app.url}): status=${app.statusCode}, ${app.responseTimeMs}ms`;
        if (app.sslDaysRemaining !== undefined) {
          line += `, SSL: ${app.sslDaysRemaining}d`;
        }
        summaryLines.push(line);
      });
    }

    const summaryText = summaryLines.join("\n");

    logger?.info(`📊 [compileReport] Report compiled (tone: ${alertTone}):`, { summaryText });

    try {
      await incrementPulseCounters(inputData.length, issueApps.length, nonLiveApps.length);
      logger?.info(`📈 [compileReport] Pulse counters updated: +${inputData.length} checks, +${issueApps.length} issues, +${nonLiveApps.length} down`);
    } catch (e) {
      logger?.warn(`⚠️ [compileReport] Could not update pulse counters: ${e instanceof Error ? e.message : String(e)}`);
    }

    let pulseDue = false;
    try {
      pulseDue = await isPulseDue();
      if (pulseDue) {
        logger?.info(`📬 [compileReport] Weekly pulse email is due!`);
      }
    } catch (e) {
      logger?.warn(`⚠️ [compileReport] Could not check pulse status: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (CURRENT_RUN_ID.value) {
      try {
        await releaseRunLock(CURRENT_RUN_ID.value);
        logger?.info(`🔓 [compileReport] Run lock released: ${CURRENT_RUN_ID.value}`);
      } catch (e) {
        logger?.warn(`⚠️ [compileReport] Failed to release run lock: ${e instanceof Error ? e.message : String(e)}`);
      }
      CURRENT_RUN_ID.value = "";
    }

    return {
      totalApps: inputData.length,
      liveApps,
      nonLiveApps,
      issueApps,
      hasProblems: nonLiveApps.length > 0 || issueApps.length > 0,
      reportTimestamp: new Date().toISOString(),
      summaryText,
      groupedFailure,
      alertTone,
      pulseDue,
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
  groupedFailure: z.boolean().optional(),
  alertTone: z.string().optional(),
  pulseDue: z.boolean().optional(),
});

async function sendWeeklyPulse(logger: any): Promise<boolean> {
  try {
    const pulseState = await getPulseState();
    const weekStart = new Date(pulseState.week_start);
    const now = new Date();
    const daysCovered = Math.max(1, Math.round((now.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24)));

    logger?.info(`📬 [weeklyPulse] Sending pulse email: ${pulseState.total_checks} checks over ${daysCovered} days`);

    const pulseResponse = await monitorAgent.generateLegacy(
      [
        {
          role: "user",
          content: `Send me the Backcheck Weekly Pulse email. This is a short, trust-building summary of the past week's monitoring activity.

Here are the stats for the past ${daysCovered} day(s):
- Total checks performed: ${pulseState.total_checks}
- Total issues detected: ${pulseState.total_issues}
- Total downtime incidents: ${pulseState.total_down}

Send an email with subject "Backcheck Weekly Pulse" using the send-email-notification tool.
Write a very short, confident HTML email. The tone is calm and reassuring. Format:
- One sentence: "Backcheck ran ${pulseState.total_checks} checks over the past ${daysCovered} days."
- One sentence about issues: either "No issues were detected." or "X issues and Y downtime incidents were detected and reported."
- Sign off with: "Silence is healthy. —Backcheck"
Keep it under 5 sentences total. No tables, no charts. Just a clean pulse.

Also send a webhook notification using the send-webhook-notification tool with isAlert=false and the same brief pulse summary as plain text.`,
        },
      ],
      { maxSteps: 5 }
    );

    const pulseToolResults = pulseResponse.steps?.flatMap((s: any) => s.toolResults || []) || [];
    const pulseSent = pulseToolResults.some((r: any) => r?.result?.success === true || r?.success === true);

    if (pulseSent) {
      await resetPulseCounters();
      logger?.info(`✅ [weeklyPulse] Weekly pulse sent and counters reset`);
      return true;
    } else {
      logger?.error(`❌ [weeklyPulse] Failed to send weekly pulse email`);
      return false;
    }
  } catch (e) {
    logger?.error(`❌ [weeklyPulse] Error sending pulse: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

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
    const tone = inputData.alertTone || "calm";
    logger?.info(`🚨 [notifyNonLive] ${inputData.nonLiveApps.length} app(s) down, ${inputData.issueApps.length} issue(s)! Tone: ${tone}. Sending alert...`);

    const downSection = inputData.nonLiveApps.length > 0
      ? `\nDOWN apps:\n${inputData.nonLiveApps.map((app) => {
          let line = `- ${app.name} (${app.url}): HTTP ${app.statusCode}${app.error ? `, Error: ${app.error}` : ""}`;
          if (app.consecutiveFailures && app.consecutiveFailures > 1) {
            line += ` (consecutive failure #${app.consecutiveFailures})`;
          }
          return line;
        }).join("\n")}`
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
      if ((app.consecutiveSlow ?? 0) >= 2) {
        detail += `\n  Slow response: ${app.responseTimeMs}ms — ${app.consecutiveSlow} consecutive slow checks`;
      }
      if (app.sslExpiring) {
        detail += `\n  SSL certificate expiring in ${app.sslDaysRemaining} day(s) — users will see browser security warnings when it expires`;
      }
      if (app.contentChanged) {
        detail += `\n  ⚠️ Page content has CHANGED since last check — possible accidental deploy, hack, or wrong environment`;
      }
      if (app.consecutiveFailures && app.consecutiveFailures > 1) {
        detail += `\n  This is consecutive issue #${app.consecutiveFailures}`;
      }
      issueLines.push(detail);
    }
    const issueSection = issueLines.length > 0
      ? `\nISSUE apps:\n${issueLines.join("\n")}`
      : "";

    const liveSection = inputData.liveApps.length > 0
      ? `\nHEALTHY apps:\n${inputData.liveApps.map((app) => `- ${app.name} (${app.url}): HTTP ${app.statusCode}, ${app.responseTimeMs}ms`).join("\n")}`
      : "";

    const groupedNote = inputData.groupedFailure
      ? "\n⚠️ GROUPED FAILURE: Multiple apps failed simultaneously. This may indicate a shared dependency issue (DNS, hosting provider, shared backend).\n"
      : "";

    const subjectParts = [];
    if (inputData.nonLiveApps.length > 0) subjectParts.push(`${inputData.nonLiveApps.length} Down`);
    if (inputData.issueApps.length > 0) subjectParts.push(`${inputData.issueApps.length} Issue(s)`);
    const subject = `ALERT: ${subjectParts.join(", ")}`;

    let toneGuidance: string;
    if (tone === "calm") {
      toneGuidance = `TONE: CALM — This is the first detection of these issues. Write a measured, diagnostic email. Include full details about what was found. Start with "Backcheck detected the following during a routine check." Be thorough but not alarming.`;
    } else if (tone === "urgent") {
      toneGuidance = `TONE: URGENT — These issues have persisted across multiple consecutive checks. Write a concise, urgent email. Emphasize that this is an ongoing issue, not a transient blip. Start with "Backcheck has detected a persistent issue." Be direct and action-oriented.`;
    } else {
      toneGuidance = `TONE: BRIEF — This is an ongoing, known issue that has been reported before. Write a very short status update email. Do NOT repeat the full diagnostic — just state "Still down/affected" with current stats. Start with "Backcheck status update:" Keep it to a few lines. The user already knows the details.`;
    }

    const response = await monitorAgent.generateLegacy(
      [
        {
          role: "user",
          content: `Some of my published apps need attention. Send me an email notification.

${toneGuidance}

Here is the monitoring report:
- Total apps checked: ${inputData.totalApps}
- Apps that are DOWN: ${inputData.nonLiveApps.length}
- Apps with ISSUES: ${inputData.issueApps.length}
- Apps that are HEALTHY: ${inputData.liveApps.length}
${groupedNote}${downSection}${issueSection}${liveSection}

Send an email with subject "${subject}" using the send-email-notification tool.
Include a professional HTML email with:
- Red highlighting for down apps
- Orange/yellow highlighting for issue apps. Clearly explain:
  - "Missing biotics" means healthy signals that SHOULD appear on the page but are ABSENT (like a vital sign going flat)
  - "Warning words" means bad signals that SHOULD NOT appear on the page but WERE FOUND
  - "Content changed" means the page looks different from the last check — could be accidental deploy, hack, or wrong environment
- Green for healthy apps
Include the timestamp: ${inputData.reportTimestamp}

Also send a webhook notification using the send-webhook-notification tool with isAlert=true and a plain text summary of the issues.`,
        },
      ],
      { maxSteps: 5 }
    );

    const toolResults = response.steps?.flatMap((s: any) => s.toolResults || []) || [];
    const emailSent = toolResults.some((r: any) => r?.result?.success === true || r?.success === true);

    if (!emailSent) {
      logger?.error("❌ [notifyNonLive] Agent did not successfully send the alert email! Tool results:", { toolResults });
      return {
        notified: false,
        message: `FAILED to send alert email for ${inputData.nonLiveApps.length} down, ${inputData.issueApps.length} issue(s). Email tool was not invoked or failed.`,
      };
    }

    logger?.info(`✅ [notifyNonLive] Alert notification confirmed sent`);

    if (inputData.pulseDue) {
      await sendWeeklyPulse(logger);
    }

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
    const notifyMode = (process.env.NOTIFY_MODE || "all").toLowerCase().trim();

    if (notifyMode === "alert-only") {
      logger?.info(`✅ [confirmAllLive] All ${inputData.totalApps} app(s) are live. NOTIFY_MODE=alert-only, skipping confirmation email.`);

      if (inputData.pulseDue) {
        await sendWeeklyPulse(logger);
      }

      return {
        notified: false,
        message: `All ${inputData.totalApps} apps healthy. No email sent (alert-only mode).`,
      };
    }

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
Include the timestamp: ${inputData.reportTimestamp}

Also send a webhook notification using the send-webhook-notification tool with isAlert=false and a brief plain text confirmation.`,
        },
      ],
      { maxSteps: 5 }
    );

    const toolResults = response.steps?.flatMap((s: any) => s.toolResults || []) || [];
    const emailSent = toolResults.some((r: any) => r?.result?.success === true || r?.success === true);

    if (!emailSent) {
      logger?.error("❌ [confirmAllLive] Agent did not successfully send the confirmation email! Tool results:", { toolResults });
      return {
        notified: false,
        message: `FAILED to send confirmation email. Email tool was not invoked or failed.`,
      };
    }

    logger?.info(`✅ [confirmAllLive] Confirmation notification confirmed sent`);

    if (inputData.pulseDue) {
      await sendWeeklyPulse(logger);
    }

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
