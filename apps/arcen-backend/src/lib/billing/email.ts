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
}) {
  const result = await getResendClient().emails.send({
    from: FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });

  if (result.error) {
    throw new Error(
      typeof result.error.message === "string"
        ? result.error.message
        : "Resend rejected the email request",
    );
  }

  return result;
}

/** Sends a 6-digit email auth code for the dashboard login flow */
export async function sendEmailAuthCode(
  email: string,
  code: string,
): Promise<void> {
  await sendWithResend({
    to: email,
    subject: "Your ArcenPay sign-in code",
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign in to ArcenPay</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0"
             style="background:#111113;border:1px solid #222225;border-radius:12px;padding:40px;">
        <tr><td>
          <!-- Logo -->
          <p style="margin:0 0 32px;font-size:22px;font-weight:700;color:#ffffff;">ArcenPay</p>

          <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#ffffff;">
            Your verification code
          </h1>
          <p style="margin:0 0 28px;font-size:14px;color:#888;">
            Enter this 6-digit code in the ArcenPay dashboard to continue.
            It expires in <strong style="color:#ccc">10 minutes</strong>.
          </p>

          <div style="display:inline-block;padding:16px 24px;background:#161824;border:1px solid #2d325b;border-radius:12px;">
            <span style="display:block;font-size:32px;letter-spacing:0.35em;font-weight:700;color:#ffffff;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;">
              ${code}
            </span>
          </div>

          <p style="margin:28px 0 0;font-size:12px;color:#555;">
            If you did not request this code, you can safely ignore this email.
          </p>

          <hr style="margin:32px 0;border:none;border-top:1px solid #222225;" />
          <p style="margin:0;font-size:12px;color:#444;">
            ArcenPay will never ask you to share this code over chat or email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
 </html>`,
  });
}

/** Sends a team invitation email with a magic link to join the workspace */
export async function sendTeamInviteEmail(
  email: string,
  token: string,
  teamName: string,
  inviterEmail: string | null,
): Promise<void> {
  const url = `${APP_URL}/invite?token=${encodeURIComponent(token)}`;
  const inviterText = inviterEmail
    ? `<strong style="color:#ccc">${inviterEmail}</strong>`
    : "A team admin";

  await sendWithResend({
    to: email,
    subject: `You've been invited to ${teamName} on ArcenPay`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You've been invited to ${teamName}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0"
             style="background:#111113;border:1px solid #222225;border-radius:12px;padding:40px;">
        <tr><td>
          <p style="margin:0 0 32px;font-size:22px;font-weight:700;color:#ffffff;">ArcenPay</p>

          <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#ffffff;">
            You've been invited to join <span style="color:#6366f1;">${teamName}</span>
          </h1>
          <p style="margin:0 0 28px;font-size:14px;color:#888;">
            ${inviterText} has added you to the <strong style="color:#ccc">${teamName}</strong>
            workspace on ArcenPay. Click the button below, verify your email, and we'll add you automatically.
            This invite expires in <strong style="color:#ccc">7 days</strong>.
          </p>

          <a href="${url}"
             style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;
                    text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            Accept Invitation
          </a>

          <p style="margin:28px 0 0;font-size:12px;color:#555;">
            Or copy and paste this URL into your browser:<br />
            <a href="${url}" style="color:#6366f1;word-break:break-all;">${url}</a>
          </p>

          <hr style="margin:32px 0;border:none;border-top:1px solid #222225;" />
          <p style="margin:0;font-size:12px;color:#444;">
            If you weren't expecting this invitation, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
 </html>`,
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
  total: string;
  currency: string;
  paidAt?: string | null;
  downloadUrl?: string | null;
};

type CreditNoteEmailInput = {
  to: string;
  invoiceNumber: string;
  noteNumber: string;
  amount: string;
  currency: string;
  reason: string;
};

/** Sends a credit note notification email to a subscriber/customer */
export async function sendCreditNoteEmail(input: CreditNoteEmailInput): Promise<void> {
  await sendWithResend({
    to: input.to,
    subject: `Credit Note ${input.noteNumber} issued for Invoice ${input.invoiceNumber}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Credit Note ${input.noteNumber}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border:1px solid #d8dde6;border-radius:12px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">ArcenPay</p>
          <h1 style="margin:0 0 10px;font-size:20px;font-weight:600;color:#111827;">
            Credit Note Issued
          </h1>
          <p style="margin:0 0 20px;font-size:14px;color:#4b5563;">
            A credit note has been applied to your invoice
            <strong>${input.invoiceNumber}</strong>.<br /><br />
            Credit Note #: <strong>${input.noteNumber}</strong><br />
            Amount credited: <strong>${input.amount} ${input.currency}</strong><br />
            Reason: ${input.reason}
          </p>
          <p style="margin:18px 0 0;font-size:12px;color:#6b7280;">
            If you have any questions, please contact your service provider.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
 </html>`,
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

  await sendWithResend({
    to: input.to,
    subject: `Invoice ${input.invoiceNumber} from ArcenPay`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice ${input.invoiceNumber}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border:1px solid #d8dde6;border-radius:12px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">ArcenPay</p>
          <h1 style="margin:0 0 10px;font-size:20px;font-weight:600;color:#111827;">
            Invoice ${input.invoiceNumber}
          </h1>
          <p style="margin:0 0 20px;font-size:14px;color:#4b5563;">
            Amount due: <strong>${input.total} ${input.currency}</strong><br />
            Due date: <strong>${dueDate}</strong>
          </p>
          <a href="${downloadUrl}"
             style="display:inline-block;padding:11px 22px;background:#1d4ed8;color:#fff;
                    text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            View Invoice
          </a>
          <p style="margin:18px 0 0;font-size:12px;color:#6b7280;">
            If the button does not work, open: <a href="${downloadUrl}" style="color:#1d4ed8;">${downloadUrl}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}

/** Sends a payment receipt email after an invoice has been paid */
export async function sendPaymentReceiptEmail(
  input: ReceiptEmailInput,
): Promise<void> {
  const paidAt = input.paidAt
    ? new Date(input.paidAt).toLocaleDateString()
    : new Date().toLocaleDateString();
  const downloadUrl =
    input.downloadUrl ||
    `${APP_URL}/invoices/${encodeURIComponent(input.invoiceNumber)}`;

  await sendWithResend({
    to: input.to,
    subject: `Payment receipt for Invoice ${input.invoiceNumber}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment receipt for ${input.invoiceNumber}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border:1px solid #d8dde6;border-radius:12px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">ArcenPay</p>
          <h1 style="margin:0 0 10px;font-size:20px;font-weight:600;color:#111827;">
            Payment received
          </h1>
          <p style="margin:0 0 20px;font-size:14px;color:#4b5563;">
            We received <strong>${input.total} ${input.currency}</strong> for invoice
            <strong>${input.invoiceNumber}</strong> on <strong>${paidAt}</strong>.
          </p>
          <a href="${downloadUrl}"
             style="display:inline-block;padding:11px 22px;background:#059669;color:#fff;
                    text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            Download receipt
          </a>
          <p style="margin:18px 0 0;font-size:12px;color:#6b7280;">
            Need the invoice PDF too? Use the same link above or open:
            <a href="${downloadUrl}" style="color:#059669;">${downloadUrl}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}

/** Sends a welcome email to new ArcenPay providers on sign-up */
export async function sendWelcomeEmail(
  email: string,
  firstName?: string,
): Promise<void> {
  const greeting = firstName ? `Welcome, ${firstName}!` : "Welcome to ArcenPay!";
  const dashboardUrl = APP_URL ?? "https://app.arcenpay.xyz";

  await sendWithResend({
    to: email,
    subject: "Welcome to ArcenPay — your billing infrastructure is ready",
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ArcenPay</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0"
             style="background:#111113;border:1px solid #222225;border-radius:12px;padding:40px;">
        <tr><td>
          <p style="margin:0 0 32px;font-size:22px;font-weight:700;color:#ffffff;">ArcenPay</p>

          <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#ffffff;">${greeting}</h1>
          <p style="margin:0 0 20px;font-size:14px;color:#888;line-height:1.6;">
            Your ArcenPay provider account is ready. You can now set up plans, feature flags,
            and embed a billing portal directly into your product — no backend required.
          </p>

          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#ccc;">Get started in 3 steps:</p>
          <ol style="margin:0 0 28px;padding-left:20px;font-size:13px;color:#888;line-height:2;">
            <li>Create an API key in your dashboard</li>
            <li>Call <code style="color:#6366f1;font-size:12px;">/api/v1/access-tokens</code> from your backend to identify customers</li>
            <li>Embed <code style="color:#6366f1;font-size:12px;">&lt;ArcenEmbed /&gt;</code> in your product</li>
          </ol>

          <a href="${dashboardUrl}"
             style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;
                    text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            Open Dashboard
          </a>

          <hr style="margin:32px 0;border:none;border-top:1px solid #222225;" />
          <p style="margin:0;font-size:12px;color:#444;">
            Questions? Reply to this email — we read every one.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
 </html>`,
  });
}
