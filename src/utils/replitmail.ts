import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { z } from "zod";
import pRetry, { AbortError } from "p-retry";

// Replit Mail integration - sends emails to the user's verified Replit email
// Note: to/cc are not included - emails are sent to the user's verified Replit email
export const zSmtpMessage = z.object({
  subject: z.string().describe("Email subject"),
  text: z.string().optional().describe("Plain text body"),
  html: z.string().optional().describe("HTML body"),
  attachments: z
    .array(
      z.object({
        filename: z.string().describe("File name"),
        content: z.string().describe("Base64 encoded content"),
        contentType: z.string().optional().describe("MIME type"),
        encoding: z
          .enum(["base64", "7bit", "quoted-printable", "binary"])
          .default("base64"),
      })
    )
    .optional()
    .describe("Email attachments"),
});

export type SmtpMessage = z.infer<typeof zSmtpMessage>;

async function getAuthToken(): Promise<{ authToken: string; hostname: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) {
    throw new Error("REPLIT_CONNECTORS_HOSTNAME is not configured");
  }
  const { stdout } = await promisify(execFile)(
    "replit",
    ["identity", "create", "--audience", `https://${hostname}`],
    { encoding: "utf8" }
  );

  const replitToken = stdout.trim();
  if (!replitToken) {
    throw new Error("Replit Identity Token not found for repl/depl");
  }

  return { authToken: `Bearer ${replitToken}`, hostname };
}

export async function sendEmail(message: SmtpMessage): Promise<{
  accepted: string[];
  rejected: string[];
  pending?: string[];
  messageId: string;
  response: string;
}> {
  return pRetry(
    async (_attemptNumber: number) => {
      const { hostname, authToken } = await getAuthToken();

      const response = await fetch(`https://${hostname}/api/v2/mailer/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Replit-Authentication": authToken,
        },
        body: JSON.stringify({
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: message.attachments,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { message?: string };
        const status = response.status;
        const msg = (error as any).message || `HTTP ${status}`;
        // 4xx errors are non-retriable (bad request, auth failure, etc.)
        if (status >= 400 && status < 500) {
          throw new AbortError(msg);
        }
        // 5xx and network errors are retriable
        throw new Error(`[replitmail] Send failed: ${msg}`);
      }

      return await response.json();
    },
    {
      retries: 2,
      minTimeout: 1000,
      maxTimeout: 5000,
      onFailedAttempt: (error: any) => {
        console.warn(
          `[replitmail] Email send attempt ${error.attemptNumber}/${error.retriesLeft + error.attemptNumber} failed: ${error.message}`
        );
      },
    }
  );
}
