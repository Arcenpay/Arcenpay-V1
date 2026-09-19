// ============================================================
//  Dashboard — Email helper (server-only)
//  Sends transactional emails via Resend.
//  https://resend.com/docs
// ============================================================

import { Resend } from "resend";
import { RESEND_API_KEY, EMAIL_FROM, APP_URL } from "../../config.js";

const FROM = EMAIL_FROM;
let resendClient: Resend | null = null;

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(RESEND_API_KEY?.trim() && FROM?.trim());
}

function requireEmailConfig() {
  if (!RESEND_API_KEY?.trim()) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  if (!FROM?.trim()) {
    throw new Error("EMAIL_FROM is not configured");
  }
}

function getResendClient(): Resend {
  requireEmailConfig();
  if (!resendClient) {
    resendClient = new Resend(RESEND_API_KEY);
  }
  return resendClient;
}

async function sendWithResend(input: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType?: string;
  }>;
}) {
  const sender = input.from || FROM || "noreply@arcenpay.com";
  const result = await getResendClient().emails.send({
    from: sender,
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
    })),
  } as any);

  if (result.error) {
    throw new Error(
      typeof result.error.message === "string"
        ? result.error.message
        : "Resend rejected the email request",
    );
  }

  return result;
}

/** Sends a 6-digit email auth code for the dashboard login flow (automated from noreply) */
const LOGO_IMAGE_URL = "https://app.arcenpay.com/arcenpay-logo.png";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface ArcenpayEmailLayoutInput {
  title: string;
  recipientEmail?: string | null;
  children: string;
  dashboardUrl?: string;
}

function renderArcenpayEmailLayout(input: ArcenpayEmailLayoutInput): string {
  const title = escapeHtml(input.title);
  const dashUrl = input.dashboardUrl ?? (APP_URL || "https://app.arcenpay.com");
  const recipientEmail = input.recipientEmail?.trim();
  const escapedRecipient = recipientEmail ? escapeHtml(recipientEmail) : null;
  const preferencesUrl = `${dashUrl}/settings/notifications`;
  const xUrl = "https://x.com/arcenpayhq";
  const linkedInUrl = "https://www.linkedin.com/company/arcenpay";
  const githubUrl = "https://github.com/arcenpay";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#0a0a0a;">
  <!-- Outer Table Canvas -->
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#fafafa;margin:0;padding:40px 16px 60px;">
    <tr>
      <td align="center" style="margin:0;padding:0;">
        <!-- Centered Email Container Card (max 560px) -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 8px 24px -4px rgba(0,0,0,0.03);text-align:left;">
          
          <!-- Brand Header: Official ArcenPay Logo -->
          <tr>
            <td style="padding:28px 36px 20px 36px;background-color:#ffffff;">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="vertical-align:middle;line-height:0;">
                    <a href="${dashUrl}" style="text-decoration:none;display:inline-block;">
                      <img src="${LOGO_IMAGE_URL}" alt="ArcenPay" width="138" height="34" style="display:block;height:32px;width:auto;border:0;outline:none;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;font-size:20px;font-weight:700;color:#0a0a0a;letter-spacing:-0.5px;" />
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Subtle Divider -->
          <tr>
            <td style="padding:0 36px;">
              <div style="height:1px;background-color:#f4f4f5;line-height:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Main Email Content Slot -->
          <tr>
            <td style="padding:28px 36px 32px 36px;background-color:#ffffff;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                ${input.children}
              </table>
            </td>
          </tr>

          <!-- Footer Divider -->
          <tr>
            <td style="padding:0 36px;">
              <div style="height:1px;background-color:#f4f4f5;line-height:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Footer Area -->
          <tr>
            <td style="padding:24px 36px 32px 36px;background-color:#fafafa;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding:0 0 10px 0;font-size:12px;line-height:18px;color:#71717a;">
                    ${
                      escapedRecipient
                        ? `This email was sent to <a href="mailto:${escapedRecipient}" style="color:#71717a;text-decoration:underline;">${escapedRecipient}</a>. To change which emails you receive, <a href="${preferencesUrl}" style="color:#71717a;text-decoration:underline;">manage your notification settings</a>.`
                        : `To manage your email preferences, visit your <a href="${preferencesUrl}" style="color:#71717a;text-decoration:underline;">notification settings</a>.`
                    }
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 20px 0;font-size:12px;line-height:18px;color:#71717a;">
                    &copy; 2026 ArcenPay Protocol. All rights reserved.
                  </td>
                </tr>
                <tr>
                  <td>
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <!-- Left: Mini Brand Logo -->
                        <td align="left" style="vertical-align:middle;">
                          <a href="${dashUrl}" style="text-decoration:none;display:inline-block;">
                            <img src="${LOGO_IMAGE_URL}" alt="ArcenPay" width="92" height="23" style="display:block;height:22px;width:auto;border:0;outline:none;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;font-size:13px;font-weight:700;color:#71717a;letter-spacing:-0.3px;opacity:0.85;" />
                          </a>
                        </td>

                        <!-- Right: Clean Social Icons (X, LinkedIn, GitHub) -->
                        <td align="right" style="vertical-align:middle;">
                          <table cellpadding="0" cellspacing="0" role="presentation">
                            <tr>
                              <!-- X (Twitter) -->
                              <td style="padding-left:14px;">
                                <a href="${xUrl}" style="display:inline-block;color:#71717a;text-decoration:none;" title="X (Twitter)">
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;color:#71717a;">
                                    <path d="M4 4l11.733 16h4.267l-11.733 -16z"></path>
                                    <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"></path>
                                  </svg>
                                </a>
                              </td>
                              <!-- LinkedIn -->
                              <td style="padding-left:14px;">
                                <a href="${linkedInUrl}" style="display:inline-block;color:#71717a;text-decoration:none;" title="LinkedIn">
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;color:#71717a;">
                                    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
                                    <rect x="2" y="9" width="4" height="12"></rect>
                                    <circle cx="4" cy="4" r="2"></circle>
                                  </svg>
                                </a>
                              </td>
                              <!-- GitHub -->
                              <td style="padding-left:14px;">
                                <a href="${githubUrl}" style="display:inline-block;color:#71717a;text-decoration:none;" title="GitHub">
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;color:#71717a;">
                                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                                  </svg>
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Backwards-compatible alias */
const renderUntitledEmailLayout = renderArcenpayEmailLayout;

/** Sends a 6-digit email auth code for the dashboard login flow (automated from noreply) */
export async function sendEmailAuthCode(
  email: string,
  code: string,
): Promise<void> {
  const dashUrl = APP_URL || "https://app.arcenpay.com";
  const loginUrl = `${dashUrl}/login`;
  const digits = code.trim().split("");

  const digitBoxesHtml = digits
    .map(
      (digit) => `
      <td style="padding:0 4px;">
        <table cellpadding="0" cellspacing="0" role="presentation" style="border:1.5px solid #e4e4e7;border-radius:10px;background-color:#fafafa;width:50px;height:56px;text-align:center;">
          <tr>
            <td align="center" valign="middle" style="font-size:28px;font-weight:800;color:#0001fd;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;line-height:56px;width:50px;height:56px;">
              ${escapeHtml(digit)}
            </td>
          </tr>
        </table>
      </td>`,
    )
    .join("");

  const bodyHtml = `
    <!-- Category Eyebrow -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <div style="font-size:11px;font-weight:700;color:#0001fd;text-transform:uppercase;letter-spacing:0.06em;">
          Verification Code
        </div>
      </td>
    </tr>

    <!-- Heading -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">
          Sign in to ArcenPay
        </h1>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 24px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        Enter the 6-digit code below to sign in to your ArcenPay workspace:
      </td>
    </tr>

    <!-- Digit Boxes -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            ${digitBoxesHtml}
          </tr>
        </table>
      </td>
    </tr>

    <!-- Expiration & Explanation -->
    <tr>
      <td style="padding:0 0 20px 0;font-size:13px;line-height:20px;color:#71717a;">
        This code is valid for <strong>10 minutes</strong>. If you did not request this login code, you can safely ignore this email.
      </td>
    </tr>

    <!-- Security advisory -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <div style="background-color:#fafafa;border:1px solid #e4e4e7;border-left:3px solid #0001fd;padding:12px 16px;border-radius:0 8px 8px 0;font-size:13px;color:#3f3f46;line-height:20px;">
          Never share this code with anyone. ArcenPay will never ask for your verification code.
        </div>
      </td>
    </tr>

    <!-- CTA Button (Pill Rounded) -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td align="center" style="border-radius:9999px;background-color:#0a0a0a;">
              <a href="${loginUrl}" style="display:inline-block;padding:13px 30px;color:#ffffff;background-color:#0a0a0a;border:1px solid #0a0a0a;border-radius:9999px;font-size:14px;font-weight:600;text-decoration:none;text-align:center;letter-spacing:-0.01em;">
                Sign in to dashboard &rarr;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Sign-off -->
    <tr>
      <td style="padding:0;font-size:14px;line-height:22px;color:#71717a;">
        The ArcenPay team
      </td>
    </tr>`;

  await sendWithResend({
    to: email,
    subject: `${code} is your ArcenPay verification code`,
    html: renderArcenpayEmailLayout({
      title: "Your ArcenPay Verification Code",
      recipientEmail: email,
      children: bodyHtml,
      dashboardUrl: dashUrl,
    }),
  });
}

/** Sends a team invitation email with a magic link to join the workspace */
export async function sendTeamInviteEmail(
  email: string,
  token: string,
  teamName: string,
  inviterEmail: string | null,
): Promise<void> {
  const dashUrl = APP_URL || "https://app.arcenpay.com";
  const url = `${dashUrl}/invite?token=${encodeURIComponent(token)}`;
  const inviterText = inviterEmail ? escapeHtml(inviterEmail) : "A team administrator";
  const escapedTeamName = escapeHtml(teamName);

  const bodyHtml = `
    <!-- Category Eyebrow -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <div style="font-size:11px;font-weight:700;color:#0001fd;text-transform:uppercase;letter-spacing:0.06em;">
          Team Invitation
        </div>
      </td>
    </tr>

    <!-- Heading -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">
          Join ${escapedTeamName} on ArcenPay
        </h1>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 20px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        <strong>${inviterText}</strong> has invited you to collaborate on <strong>${escapedTeamName}</strong> on ArcenPay.
      </td>
    </tr>

    <!-- Team Invite Card -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e4e4e7;border-radius:12px;background-color:#fafafa;padding:18px 20px;">
          <tr>
            <td style="vertical-align:middle;">
              <div style="font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Workspace</div>
              <div style="font-size:16px;font-weight:700;color:#0a0a0a;">${escapedTeamName}</div>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="display:inline-block;padding:4px 10px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:9999px;font-size:11px;font-weight:600;color:#0001fd;">
                Pending Invite
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- CTA Button (Pill Rounded) -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td align="center" style="border-radius:9999px;background-color:#0a0a0a;">
              <a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 32px;color:#ffffff;background-color:#0a0a0a;border:1px solid #0a0a0a;border-radius:9999px;font-size:14px;font-weight:600;text-decoration:none;text-align:center;letter-spacing:-0.01em;">
                Accept invitation &rarr;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Expiry info -->
    <tr>
      <td style="padding:0 0 20px 0;font-size:13px;line-height:20px;color:#71717a;">
        This invitation link will expire in 7 days. If you weren&#39;t expecting this invitation, you can safely ignore this email.
      </td>
    </tr>

    <!-- Sign-off -->
    <tr>
      <td style="padding:0;font-size:14px;line-height:22px;color:#71717a;">
        The ArcenPay team
      </td>
    </tr>`;

  await sendWithResend({
    to: email,
    subject: `You've been invited to join ${teamName} on ArcenPay`,
    html: renderArcenpayEmailLayout({
      title: `Invitation to join ${teamName}`,
      recipientEmail: email,
      children: bodyHtml,
      dashboardUrl: dashUrl,
    }),
  });
}

type InvoiceEmailInput = {
  to: string;
  invoiceNumber: string;
  total: string;
  currency: string;
  dueDate?: string | null;
  downloadUrl?: string | null;
};

type ReceiptEmailInput = {
  to: string;
  invoiceNumber: string;
  receiptNumber: string;
  total: string;
  currency: string;
  paidAt?: string | null;
  providerName: string;
  paymentMethod: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
  supportUrl?: string | null;
  invoiceDownloadUrl?: string | null;
  receiptDownloadUrl?: string | null;
  subtotal: string;
  taxTotal: string;
  amountPaid: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: string;
    total: string;
  }>;
  invoicePdf: {
    filename: string;
    contentBase64: string;
  };
  receiptPdf: {
    filename: string;
    contentBase64: string;
  };
};

type CreditNoteEmailInput = {
  to: string;
  invoiceNumber: string;
  noteNumber: string;
  amount: string;
  currency: string;
  reason: string;
};

type SubscriptionPlanChangeEmailInput = {
  to: string;
  customerName?: string | null;
  changeKind:
    | "downgrade_scheduled"
    | "downgrade_applied"
    | "cancellation_scheduled"
    | "cancellation_applied";
  currentPlanName?: string | null;
  targetPlanName?: string | null;
  effectiveAt?: string | null;
};

function formatEmailDate(value?: string | null): string {
  if (!value) {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date());
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date());
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMoneyAmount(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  const sign = numeric < 0 ? "-" : "";
  return `${sign}${Math.abs(numeric).toFixed(2)}`;
}

function formatMoneyWithCurrency(value: string, currency: string): string {
  const code = currency.trim().toUpperCase();
  const amount = formatMoneyAmount(value);
  if (code === "USD") return `${value.startsWith("-") ? "-" : ""}$${formatMoneyAmount(value).replace(/^-/, "")}`;
  return `${amount} ${escapeHtml(code)}`;
}

function arcenpayEmailShell(input: {
  title: string;
  headerLeft: string;
  headerRight: string;
  children: string;
}): string {
  const title = escapeHtml(input.title);
  const left = escapeHtml(input.headerLeft);
  const right = escapeHtml(input.headerRight);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f5f9;padding:32px 16px 24px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;">
        <tr>
          <td align="center" style="padding:0 0 18px;">
            <table cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="width:22px;height:22px;border-radius:11px;background:#0a0a0a;color:#ffffff;font-size:11px;font-weight:700;text-align:center;line-height:22px;">A</td>
                <td style="padding-left:9px;font-size:14px;line-height:22px;font-weight:700;color:#0a0a0a;">ArcenPay</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid #e7e9ef;border-radius:16px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="padding:20px 28px 16px;border-bottom:1px solid #eceef3;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td style="font-size:15px;line-height:22px;font-weight:600;color:#0a0a0a;">${left}</td>
                      <td align="right" style="font-size:10px;line-height:20px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9aa0ab;">${right}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr><td style="padding:26px 28px 30px;">${input.children}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:18px 0 0;font-size:11px;line-height:18px;color:#8b8f98;">
            Powered by <span style="font-weight:700;color:#0a0a0a;">ArcenPay</span> Billing &middot; On-chain payments
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildSubscriptionPlanChangeCopy(
  input: SubscriptionPlanChangeEmailInput,
): { subject: string; heading: string; message: string } {
  const customerPrefix = input.customerName?.trim()
    ? `${escapeHtml(input.customerName.trim())}, `
    : "";
  const effectiveAt = formatEmailDate(input.effectiveAt);
  const currentPlan = input.currentPlanName?.trim()
    ? escapeHtml(input.currentPlanName.trim())
    : "your current plan";
  const targetPlan = input.targetPlanName?.trim()
    ? escapeHtml(input.targetPlanName.trim())
    : "your updated plan";

  switch (input.changeKind) {
    case "downgrade_scheduled":
      return {
        subject: "Your ArcenPay plan downgrade is scheduled",
        heading: "Plan downgrade scheduled",
        message: `${customerPrefix}your subscription will stay on <strong>${currentPlan}</strong> until <strong>${effectiveAt}</strong>. After that, it will move to <strong>${targetPlan}</strong> automatically.`,
      };
    case "downgrade_applied":
      return {
        subject: "Your ArcenPay plan has been updated",
        heading: "Plan downgrade applied",
        message: `${customerPrefix}your subscription changed from <strong>${currentPlan}</strong> to <strong>${targetPlan}</strong> on <strong>${effectiveAt}</strong>.`,
      };
    case "cancellation_scheduled":
      return {
        subject: "Your ArcenPay cancellation is scheduled",
        heading: "Cancellation scheduled",
        message: `${customerPrefix}your subscription stays active until <strong>${effectiveAt}</strong>. After that, recurring billing will stop.`,
      };
    default:
      return {
        subject: "Your ArcenPay subscription has been cancelled",
        heading: "Subscription cancelled",
        message: `${customerPrefix}your subscription ended on <strong>${effectiveAt}</strong>.`,
      };
  }
}

export async function sendSubscriptionPlanChangeEmail(
  input: SubscriptionPlanChangeEmailInput,
): Promise<void> {
  const dashUrl = APP_URL ?? "https://app.arcenpay.com";
  const copy = buildSubscriptionPlanChangeCopy(input);

  const bodyHtml = `
    <!-- Category Eyebrow -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <div style="font-size:11px;font-weight:700;color:#0001fd;text-transform:uppercase;letter-spacing:0.06em;">
          Subscription Update
        </div>
      </td>
    </tr>

    <!-- Main Heading -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">
          ${escapeHtml(copy.heading)}
        </h1>
      </td>
    </tr>

    <!-- Body Copy -->
    <tr>
      <td style="padding:0 0 20px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        ${copy.message}
      </td>
    </tr>

    <!-- CTA to Manage Subscription (Pill Rounded) -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td align="center" style="border-radius:9999px;background-color:#0a0a0a;">
              <a href="${dashUrl}" style="display:inline-block;padding:13px 30px;color:#ffffff;background-color:#0a0a0a;border:1px solid #0a0a0a;border-radius:9999px;font-size:14px;font-weight:600;text-decoration:none;text-align:center;letter-spacing:-0.01em;">
                Manage subscription &rarr;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Support Sign-off -->
    <tr>
      <td style="padding:0;font-size:13px;line-height:20px;color:#71717a;">
        If you have any questions or did not authorize this change, please reach out to <a href="mailto:support@arcenpay.com" style="color:#0001fd;text-decoration:underline;font-weight:600;">support@arcenpay.com</a>.
      </td>
    </tr>`;

  await sendWithResend({
    to: input.to,
    subject: copy.subject,
    html: renderArcenpayEmailLayout({
      title: copy.heading,
      recipientEmail: input.to,
      children: bodyHtml,
      dashboardUrl: dashUrl,
    }),
  });
}

/** Sends a credit note notification email to a subscriber/customer */
export async function sendCreditNoteEmail(input: CreditNoteEmailInput): Promise<void> {
  const dashUrl = APP_URL ?? "https://app.arcenpay.com";
  const formattedAmount = formatMoneyWithCurrency(input.amount, input.currency);

  const bodyHtml = `
    <!-- Category Eyebrow -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <div style="font-size:11px;font-weight:700;color:#0001fd;text-transform:uppercase;letter-spacing:0.06em;">
          Credit Note
        </div>
      </td>
    </tr>

    <!-- Main Heading -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">
          Credit note issued
        </h1>
      </td>
    </tr>

    <!-- Summary Paragraph -->
    <tr>
      <td style="padding:0 0 20px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        A credit note has been applied to your invoice <strong>${escapeHtml(input.invoiceNumber)}</strong>.
      </td>
    </tr>

    <!-- Credit Note Details Card -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e4e4e7;border-radius:12px;background-color:#fafafa;padding:18px 20px;">
          <tr>
            <td style="font-size:13px;line-height:22px;color:#3f3f46;">
              <div style="margin-bottom:6px;"><strong style="color:#0a0a0a;">Credit Note:</strong> ${escapeHtml(input.noteNumber)}</div>
              <div style="margin-bottom:6px;"><strong style="color:#0a0a0a;">Invoice:</strong> ${escapeHtml(input.invoiceNumber)}</div>
              <div style="margin-bottom:6px;"><strong style="color:#0a0a0a;">Amount Credited:</strong> <span style="font-weight:700;color:#0001fd;">${formattedAmount}</span></div>
              <div><strong style="color:#0a0a0a;">Reason:</strong> ${escapeHtml(input.reason)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- CTA Button (Pill Rounded) -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td align="center" style="border-radius:9999px;background-color:#0a0a0a;">
              <a href="${dashUrl}" style="display:inline-block;padding:13px 30px;color:#ffffff;background-color:#0a0a0a;border:1px solid #0a0a0a;border-radius:9999px;font-size:14px;font-weight:600;text-decoration:none;text-align:center;letter-spacing:-0.01em;">
                View in dashboard &rarr;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Sign-off -->
    <tr>
      <td style="padding:0;font-size:13px;line-height:20px;color:#71717a;">
        Questions? Contact us at <a href="mailto:support@arcenpay.com" style="color:#0001fd;text-decoration:underline;font-weight:600;">support@arcenpay.com</a>.
      </td>
    </tr>`;

  await sendWithResend({
    to: input.to,
    subject: `Credit Note ${input.noteNumber} issued for Invoice ${input.invoiceNumber}`,
    html: renderArcenpayEmailLayout({
      title: `Credit Note ${input.noteNumber}`,
      recipientEmail: input.to,
      children: bodyHtml,
      dashboardUrl: dashUrl,
    }),
  });
}

/** Sends an invoice email to a subscriber/customer */
export async function sendInvoiceEmail(input: InvoiceEmailInput): Promise<void> {
  const dueDate = input.dueDate
    ? new Date(input.dueDate).toLocaleDateString()
    : "On receipt";
  const downloadUrl =
    input.downloadUrl ||
    `${APP_URL}/invoices/${encodeURIComponent(input.invoiceNumber)}`;

  const bodyHtml = `
    <!-- Category Eyebrow -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <div style="font-size:11px;font-weight:700;color:#0001fd;text-transform:uppercase;letter-spacing:0.06em;">
          Invoice Issued
        </div>
      </td>
    </tr>

    <!-- Main Heading -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">
          Invoice ${escapeHtml(input.invoiceNumber)}
        </h1>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 20px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        A new invoice has been issued for your subscription.
      </td>
    </tr>

    <!-- Amount Due Card -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e4e4e7;border-radius:12px;background-color:#fafafa;padding:22px 20px;">
          <tr>
            <td>
              <div style="font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Amount Due</div>
              <div style="font-size:32px;line-height:38px;font-weight:800;color:#0a0a0a;letter-spacing:-0.03em;margin-bottom:8px;">${formatMoneyWithCurrency(input.total, input.currency)}</div>
              <div style="font-size:13px;color:#71717a;">Due date: <strong style="color:#0a0a0a;">${escapeHtml(dueDate)}</strong></div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- CTA Button (Pill Rounded) -->
    <tr>
      <td style="padding:0 0 20px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td align="center" style="border-radius:9999px;background-color:#0a0a0a;">
              <a href="${downloadUrl}" style="display:inline-block;padding:13px 32px;color:#ffffff;background-color:#0a0a0a;border:1px solid #0a0a0a;border-radius:9999px;font-size:14px;font-weight:600;text-decoration:none;text-align:center;letter-spacing:-0.01em;">
                View invoice &rarr;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Direct link info -->
    <tr>
      <td style="padding:0;font-size:12px;line-height:18px;color:#71717a;">
        Button not working? Open <a href="${downloadUrl}" style="color:#0001fd;text-decoration:underline;">${escapeHtml(downloadUrl)}</a> directly in your browser.
      </td>
    </tr>`;

  await sendWithResend({
    to: input.to,
    subject: `Invoice ${input.invoiceNumber} from ArcenPay`,
    html: renderArcenpayEmailLayout({
      title: `Invoice ${input.invoiceNumber}`,
      recipientEmail: input.to,
      children: bodyHtml,
      dashboardUrl: APP_URL,
    }),
  });
}

/** Sends a payment receipt email after an invoice has been paid */
export async function sendPaymentReceiptEmail(
  input: ReceiptEmailInput,
): Promise<{ id?: string }> {
  const paidAt = formatEmailDate(input.paidAt);
  const totalLabel = formatMoneyWithCurrency(input.total, input.currency);
  const subtotalLabel = formatMoneyWithCurrency(input.subtotal, input.currency);
  const taxLabel = formatMoneyWithCurrency(input.taxTotal, input.currency);
  const amountPaidLabel = formatMoneyWithCurrency(input.amountPaid, input.currency);
  const encodedSupportEmail = input.supportEmail
    ? encodeURIComponent(input.supportEmail)
    : null;
  const escapedProviderName = escapeHtml(input.providerName);
  const escapedReceiptNumber = escapeHtml(input.receiptNumber);
  const escapedInvoiceNumber = escapeHtml(input.invoiceNumber);
  const escapedPaymentMethod = escapeHtml(input.paymentMethod);
  const receiptLineItems = input.lineItems.length > 0
    ? input.lineItems
    : [
        {
          description: `Invoice ${input.invoiceNumber}`,
          quantity: 1,
          unitAmount: input.total,
          total: input.total,
        },
      ];
  const lineItemsHtml = receiptLineItems
    .map((line) => {
      const description = escapeHtml(line.description);
      const quantity = escapeHtml(String(line.quantity));
      const total = formatMoneyWithCurrency(line.total, input.currency);
      const unitAmount = formatMoneyWithCurrency(line.unitAmount, input.currency);

      return `
        <tr>
          <td style="padding:0 0 16px;vertical-align:top;">
            <div style="font-size:14px;line-height:20px;font-weight:600;color:#0a0a0a;">${description}</div>
            <div style="margin-top:2px;font-size:12px;line-height:18px;color:#71717a;">Qty ${quantity} &middot; ${unitAmount}</div>
          </td>
          <td align="right" style="padding:0 0 16px;vertical-align:top;font-size:14px;line-height:20px;font-weight:600;color:#0a0a0a;white-space:nowrap;">
            ${total}
          </td>
        </tr>`;
    })
    .join("");
  const taxRow =
    Number(input.taxTotal) > 0
      ? `
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#71717a;">Tax</td>
          <td align="right" style="padding:4px 0;font-size:13px;color:#0a0a0a;">${taxLabel}</td>
        </tr>`
      : "";
  const supportLine = input.supportUrl
    ? `Questions? Contact us at <a href="${input.supportUrl}" style="color:#0001fd;text-decoration:underline;font-weight:600;">support</a>${input.supportEmail ? ` or <a href="mailto:${encodedSupportEmail}" style="color:#0001fd;text-decoration:underline;font-weight:600;">${escapeHtml(input.supportEmail)}</a>` : ""}${input.supportPhone ? ` or call us at ${escapeHtml(input.supportPhone)}` : ""}.`
    : input.supportEmail
      ? `Questions? Contact us at <a href="mailto:${encodedSupportEmail}" style="color:#0001fd;text-decoration:underline;font-weight:600;">${escapeHtml(input.supportEmail)}</a>${input.supportPhone ? ` or call us at ${escapeHtml(input.supportPhone)}` : ""}.`
      : input.supportPhone
        ? `Questions? Call us at ${escapeHtml(input.supportPhone)}.`
        : "Need help? Reply to this email and our team will take it from there.";

  const bodyHtml = `
    <!-- Category Eyebrow -->
    <tr>
      <td style="padding:0 0 8px 0;">
        <div style="font-size:11px;font-weight:700;color:#0001fd;text-transform:uppercase;letter-spacing:0.06em;">
          Payment Receipt
        </div>
      </td>
    </tr>

    <!-- Headline Amount -->
    <tr>
      <td style="padding:0 0 4px 0;">
        <div style="font-size:32px;line-height:38px;font-weight:800;letter-spacing:-0.03em;color:#0a0a0a;">
          ${amountPaidLabel}
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 24px 0;font-size:14px;line-height:20px;color:#71717a;">
        Paid on ${escapeHtml(paidAt)} &middot; ${escapedPaymentMethod}
      </td>
    </tr>

    <!-- Receipt Meta Table Card -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e4e4e7;border-radius:12px;background-color:#fafafa;padding:16px 20px;">
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#71717a;">Receipt Number</td>
            <td align="right" style="padding:4px 0;font-size:13px;font-weight:600;color:#0a0a0a;">${escapedReceiptNumber}</td>
          </tr>
          ${
            input.invoiceNumber
              ? `<tr>
            <td style="padding:4px 0;font-size:13px;color:#71717a;">Invoice Reference</td>
            <td align="right" style="padding:4px 0;font-size:13px;font-weight:600;color:#0a0a0a;">${escapeHtml(input.invoiceNumber)}</td>
          </tr>`
              : ""
          }
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#71717a;">Payment Method</td>
            <td align="right" style="padding:4px 0;font-size:13px;font-weight:600;color:#0a0a0a;">${escapedPaymentMethod}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#71717a;">Merchant</td>
            <td align="right" style="padding:4px 0;font-size:13px;font-weight:600;color:#0a0a0a;">${escapedProviderName}</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Line Items Table -->
    <tr>
      <td style="padding:0 0 20px 0;">
        <div style="font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Items</div>
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          ${lineItemsHtml}
          <tr>
            <td colspan="2" style="padding:6px 0 0 0;"><div style="height:1px;background-color:#e4e4e7;line-height:1px;">&nbsp;</div></td>
          </tr>
          <tr>
            <td style="padding:10px 0 4px 0;font-size:13px;color:#71717a;">Subtotal</td>
            <td align="right" style="padding:10px 0 4px 0;font-size:13px;color:#0a0a0a;">${subtotalLabel}</td>
          </tr>
          ${taxRow}
          <tr>
            <td style="padding:8px 0 0 0;font-size:14px;font-weight:700;color:#0a0a0a;">Total Paid</td>
            <td align="right" style="padding:8px 0 0 0;font-size:14px;font-weight:700;color:#0a0a0a;">${amountPaidLabel}</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Download Actions (Pill Rounded) -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            ${
              input.receiptDownloadUrl
                ? `<td style="padding-right:12px;border-radius:9999px;background-color:#0a0a0a;">
                    <a href="${input.receiptDownloadUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 24px;color:#ffffff;background-color:#0a0a0a;border:1px solid #0a0a0a;border-radius:9999px;font-size:13px;font-weight:600;text-decoration:none;text-align:center;letter-spacing:-0.01em;">
                      Download receipt PDF &rarr;
                    </a>
                   </td>`
                : `<td style="padding-right:12px;border-radius:9999px;background-color:#0a0a0a;">
                    <a href="${APP_URL || "https://app.arcenpay.com"}/settings/billing" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 24px;color:#ffffff;background-color:#0a0a0a;border:1px solid #0a0a0a;border-radius:9999px;font-size:13px;font-weight:600;text-decoration:none;text-align:center;letter-spacing:-0.01em;">
                      View billing dashboard &rarr;
                    </a>
                   </td>`
            }
            ${
              input.invoiceDownloadUrl
                ? `<td>
                    <a href="${input.invoiceDownloadUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 16px;color:#0001fd;font-size:13px;font-weight:600;text-decoration:underline;">
                      Download invoice PDF
                    </a>
                   </td>`
                : ""
            }
          </tr>
        </table>
      </td>
    </tr>

    <!-- Support Sign-off -->
    <tr>
      <td style="padding:0;font-size:13px;line-height:20px;color:#71717a;">
        ${supportLine}
      </td>
    </tr>`;

  const result = await sendWithResend({
    to: input.to,
    subject: `Your receipt from ${input.providerName} #${input.receiptNumber}`,
    html: renderArcenpayEmailLayout({
      title: `Receipt ${input.receiptNumber}`,
      recipientEmail: input.to,
      children: bodyHtml,
      dashboardUrl: APP_URL,
    }),
    attachments: [
      {
        filename: input.invoicePdf.filename,
        content: input.invoicePdf.contentBase64,
        contentType: "application/pdf",
      },
      {
        filename: input.receiptPdf.filename,
        content: input.receiptPdf.contentBase64,
        contentType: "application/pdf",
      },
    ],
  });

  return { id: (result.data as any)?.id };
}

/** Sends a welcome email to new ArcenPay providers on sign-up */
export async function sendWelcomeEmail(
  email: string,
  firstName?: string,
): Promise<void> {
  const dashUrl = APP_URL ?? "https://app.arcenpay.com";
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";

  const bodyHtml = `
    <!-- Category Eyebrow -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <div style="font-size:11px;font-weight:700;color:#0001fd;text-transform:uppercase;letter-spacing:0.06em;">
          Getting Started
        </div>
      </td>
    </tr>

    <!-- Main Title -->
    <tr>
      <td style="padding:0 0 14px 0;">
        <h1 style="margin:0;font-size:24px;line-height:32px;font-weight:800;color:#0a0a0a;letter-spacing:-0.025em;">
          Welcome to ArcenPay
        </h1>
      </td>
    </tr>

    <!-- Introductory Paragraphs -->
    <tr>
      <td style="padding:0 0 10px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        ${greeting}
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 14px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        We&#39;re excited to welcome you to ArcenPay. Your billing control plane is active and ready to manage on-chain subscriptions, credit metering, and automated invoicing.
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 24px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        Here are key resources to help you integrate and start accepting payments:
      </td>
    </tr>

    <!-- Thin Divider -->
    <tr>
      <td style="padding:0 0 16px 0;">
        <div style="height:1px;background-color:#f4f4f5;line-height:1px;">&nbsp;</div>
      </td>
    </tr>

    <!-- Resource 1: Documentation -->
    <tr>
      <td style="padding:0 0 16px 0;">
        <div style="margin-bottom:3px;">
          <a href="https://docs.arcenpay.com/introduction" style="color:#0001fd;font-size:14px;font-weight:600;text-decoration:none;">
            Platform Documentation &rarr;
          </a>
        </div>
        <div style="font-size:13px;line-height:19px;color:#71717a;">
          Architecture guides, SDK quickstarts, and API references.
        </div>
      </td>
    </tr>

    <!-- Thin Divider -->
    <tr>
      <td style="padding:0 0 16px 0;">
        <div style="height:1px;background-color:#f4f4f5;line-height:1px;">&nbsp;</div>
      </td>
    </tr>

    <!-- Resource 2: Changelog -->
    <tr>
      <td style="padding:0 0 16px 0;">
        <div style="margin-bottom:3px;">
          <a href="https://docs.arcenpay.com/changelog" style="color:#0001fd;font-size:14px;font-weight:600;text-decoration:none;">
            Changelog & Updates &rarr;
          </a>
        </div>
        <div style="font-size:13px;line-height:19px;color:#71717a;">
          Latest product improvements, SDK releases, and protocol updates.
        </div>
      </td>
    </tr>

    <!-- Thin Divider -->
    <tr>
      <td style="padding:0 0 16px 0;">
        <div style="height:1px;background-color:#f4f4f5;line-height:1px;">&nbsp;</div>
      </td>
    </tr>

    <!-- Resource 3: Community & Announcements -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <div style="margin-bottom:3px;">
          <a href="https://x.com/arcenpayhq" style="color:#0001fd;font-size:14px;font-weight:600;text-decoration:none;">
            Follow on X (@arcenpayhq) &rarr;
          </a>
        </div>
        <div style="font-size:13px;line-height:19px;color:#71717a;">
          Stay up to date with product releases and announcements.
        </div>
      </td>
    </tr>

    <!-- Support Notice -->
    <tr>
      <td style="padding:0 0 14px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        Have questions? Contact our team anytime at <a href="mailto:support@arcenpay.com" style="color:#0001fd;text-decoration:underline;font-weight:600;">support@arcenpay.com</a>.
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 24px 0;font-size:14px;line-height:22px;color:#71717a;">
        &mdash; The ArcenPay team
      </td>
    </tr>

    <!-- CTA Button (Pill Rounded) -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td align="center" style="border-radius:9999px;background-color:#0a0a0a;">
              <a href="${dashUrl}" style="display:inline-block;padding:13px 32px;color:#ffffff;background-color:#0a0a0a;border:1px solid #0a0a0a;border-radius:9999px;font-size:14px;font-weight:600;text-decoration:none;text-align:center;letter-spacing:-0.01em;">
                Open dashboard &rarr;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  await sendWithResend({
    to: email,
    subject: "Welcome to ArcenPay — your billing infrastructure is ready",
    html: renderArcenpayEmailLayout({
      title: "Welcome to ArcenPay",
      recipientEmail: email,
      children: bodyHtml,
      dashboardUrl: dashUrl,
    }),
  });
}

/** Sends a test notification email to confirm dispatch provider configuration */
export async function sendDispatchTestEmail(email: string): Promise<void> {
  const dashUrl = APP_URL ?? "https://app.arcenpay.com";

  const bodyHtml = `
    <!-- Status Eyebrow -->
    <tr>
      <td style="padding:0 0 10px 0;">
        <div style="font-size:11px;font-weight:700;color:#0001fd;text-transform:uppercase;letter-spacing:0.06em;">
          Agent Dispatch Notification
        </div>
      </td>
    </tr>

    <!-- Main Title -->
    <tr>
      <td style="padding:0 0 12px 0;">
        <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">
          Dispatch test successful
        </h1>
      </td>
    </tr>

    <!-- Content -->
    <tr>
      <td style="padding:0 0 12px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        This test message confirms that your ArcenPay Agent notifications are configured correctly and ready to deliver real-time alerts.
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 24px 0;font-size:14px;line-height:22px;color:#3f3f46;">
        When your autonomous AI agent requests funds, encounters budget limits, or requires authorization, notifications will arrive directly in this inbox.
      </td>
    </tr>

    <!-- Details Card -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e4e4e7;border-radius:12px;background-color:#fafafa;padding:16px 20px;">
          <tr>
            <td style="font-size:13px;line-height:20px;color:#3f3f46;">
              <strong style="color:#0a0a0a;">Recipient:</strong> ${escapeHtml(email)}<br />
              <strong style="color:#0a0a0a;">Notification Channel:</strong> Email Alerts<br />
              <strong style="color:#0a0a0a;">Status:</strong> Active &amp; Verified
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- CTA Button (Pill Rounded) -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td align="center" style="border-radius:9999px;background-color:#0a0a0a;">
              <a href="${dashUrl}/agents" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 30px;color:#ffffff;background-color:#0a0a0a;border:1px solid #0a0a0a;border-radius:9999px;font-size:14px;font-weight:600;text-decoration:none;text-align:center;letter-spacing:-0.01em;">
                Open agent dashboard &rarr;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Sign-off -->
    <tr>
      <td style="padding:0;font-size:13px;line-height:20px;color:#71717a;">
        The ArcenPay Agent team
      </td>
    </tr>`;

  await sendWithResend({
    to: email,
    subject: "✅ ArcenPay Agent — Dispatch Test Message",
    html: renderArcenpayEmailLayout({
      title: "ArcenPay Agent Dispatch Test",
      recipientEmail: email,
      children: bodyHtml,
      dashboardUrl: dashUrl,
    }),
  });
}

