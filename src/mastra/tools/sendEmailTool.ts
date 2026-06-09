import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sendEmail, zSmtpMessage, type SmtpMessage } from "../../utils/replitmail";
import { logNotification } from "../../utils/appState";

export const sendEmailTool = createTool({
  id: "send-email-notification",
  description:
    "Sends an email notification to the user via Replit Mail. Use this to alert the user about app monitoring results, especially when apps are down or to confirm all apps are healthy.",

  inputSchema: z.object({
    subject: z.string().describe("The email subject line"),
    html: z.string().describe("The HTML content of the email"),
    text: z.string().describe("The plain text fallback of the email"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.string().optional(),
    error: z.string().optional(),
  }),

  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(
      `📧 [sendEmailTool] Sending email with subject: "${context.subject}"`
    );

    try {
      const emailMessage: SmtpMessage = zSmtpMessage.parse({
        subject: context.subject,
        html: context.html,
        text: context.text,
      });

      const result = await sendEmail(emailMessage);

      logger?.info(
        `✅ [sendEmailTool] Email sent successfully. MessageId: ${result.messageId}`
      );

      logNotification({
        notificationType: "email",
        subject: context.subject,
        success: true,
      }).catch((e) =>
        logger?.warn(`⚠️ [sendEmailTool] Could not record notification log: ${e?.message}`)
      );

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger?.error(`❌ [sendEmailTool] Failed to send email: ${errorMessage}`);

      logNotification({
        notificationType: "email",
        subject: context.subject,
        success: false,
        error: errorMessage,
      }).catch((e) =>
        logger?.warn(`⚠️ [sendEmailTool] Could not record notification log: ${e?.message}`)
      );

      return {
        success: false,
        error: errorMessage,
      };
    }
  },
});
