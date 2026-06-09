import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import pRetry, { AbortError } from "p-retry";
import { logNotification } from "../../utils/appState";

export const sendWebhookTool = createTool({
  id: "send-webhook-notification",
  description:
    "Sends a notification to a configured webhook URL (Slack, Discord, or custom). Use this alongside or instead of email when the WEBHOOK_URL environment variable is set. For Slack, sends a formatted message. For Discord, sends an embed. For generic webhooks, sends a JSON payload.",

  inputSchema: z.object({
    subject: z.string().describe("The notification subject/title"),
    body: z.string().describe("The notification body text (plain text, not HTML)"),
    isAlert: z.boolean().describe("Whether this is an alert (true) or a routine notification (false)"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    platform: z.string().optional(),
    error: z.string().optional(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    const webhookUrl = process.env.WEBHOOK_URL;

    if (!webhookUrl) {
      logger?.warn("⚠️ [sendWebhookTool] No WEBHOOK_URL configured, skipping webhook notification");
      return {
        success: false,
        error: "No WEBHOOK_URL environment variable configured",
      };
    }

    logger?.info(`🔔 [sendWebhookTool] Sending webhook notification: "${context.subject}"`);

    let platform: string = "unknown";

    try {
      const parsedUrl = new URL(webhookUrl);
      const hostname = parsedUrl.hostname;

      let payload: object;

      if (hostname.includes("slack.com") || hostname.includes("hooks.slack.com")) {
        platform = "slack";
        const color = context.isAlert ? "#dc3545" : "#28a745";
        payload = {
          attachments: [
            {
              color,
              title: context.subject,
              text: context.body,
              footer: "Backcheck",
              ts: Math.floor(Date.now() / 1000),
            },
          ],
        };
      } else if (hostname.includes("discord.com") || hostname.includes("discordapp.com")) {
        platform = "discord";
        const color = context.isAlert ? 0xdc3545 : 0x28a745;
        payload = {
          embeds: [
            {
              title: context.subject,
              description: context.body,
              color,
              footer: { text: "Backcheck" },
              timestamp: new Date().toISOString(),
            },
          ],
        };
      } else {
        platform = "generic";
        payload = {
          subject: context.subject,
          body: context.body,
          isAlert: context.isAlert,
          timestamp: new Date().toISOString(),
          source: "backcheck",
        };
      }

      await pRetry(
        async (_attemptNumber: number) => {
          const resp = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!resp.ok) {
            const errorText = await resp.text().catch(() => "unknown");
            const status = resp.status;
            // 4xx errors (except 429) are non-retriable
            if (status >= 400 && status < 500 && status !== 429) {
              throw new AbortError(`Webhook returned HTTP ${status}: ${errorText}`);
            }
            throw new Error(
              `[sendWebhookTool] Webhook returned ${status}: ${errorText}`
            );
          }
        },
        {
          retries: 2,
          minTimeout: 1000,
          maxTimeout: 5000,
          onFailedAttempt: (error: any) => {
            logger?.warn(
              `⚠️ [sendWebhookTool] Webhook attempt ${error.attemptNumber}/${error.retriesLeft + error.attemptNumber} failed: ${error.message}`
            );
          },
        }
      );

      logger?.info(`✅ [sendWebhookTool] Webhook notification sent successfully (${platform})`);

      logNotification({
        notificationType: "webhook",
        subject: context.subject,
        success: true,
        platform,
      }).catch((e) =>
        logger?.warn(`⚠️ [sendWebhookTool] Could not record notification log: ${e?.message}`)
      );

      return { success: true, platform };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger?.error(`❌ [sendWebhookTool] Failed to send webhook: ${errorMessage}`);

      logNotification({
        notificationType: "webhook",
        subject: context.subject,
        success: false,
        error: errorMessage,
        platform: platform,
      }).catch((e) =>
        logger?.warn(`⚠️ [sendWebhookTool] Could not record notification log: ${e?.message}`)
      );

      return {
        success: false,
        error: errorMessage,
      };
    }
  },
});
