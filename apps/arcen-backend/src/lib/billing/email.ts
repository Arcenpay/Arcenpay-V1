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
  attachments?: Array<{
    filename: string;
    content: string;
    contentType?: string;
  }>;
}) {
  const result = await getResendClient().emails.send({
    from: FROM,
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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
  const copy = buildSubscriptionPlanChangeCopy(input);

  await sendWithResend({
    to: input.to,
    subject: copy.subject,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${copy.heading}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border:1px solid #d8dde6;border-radius:12px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 24px;font-size:22px;font-weight:700;color:#0f172a;">ArcenPay</p>
          <h1 style="margin:0 0 10px;font-size:20px;font-weight:600;color:#111827;">
            ${copy.heading}
          </h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#4b5563;">
            ${copy.message}
          </p>
          <p style="margin:18px 0 0;font-size:12px;color:#6b7280;">
            If you have any questions, please contact your service provider or reply to your usual billing support channel.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}

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
          <td style="padding:0 0 18px;vertical-align:top;">
            <div style="font-size:15px;line-height:22px;font-weight:600;color:#1f2937;">${description}</div>
            <div style="margin-top:4px;font-size:13px;line-height:20px;color:#6b7280;">Qty ${quantity} &middot; ${unitAmount}</div>
          </td>
          <td align="right" style="padding:0 0 18px;vertical-align:top;font-size:15px;line-height:22px;font-weight:600;color:#111827;white-space:nowrap;">
            ${total}
          </td>
        </tr>`;
    })
    .join("");
  const taxRow =
    Number(input.taxTotal) > 0
      ? `
        <tr>
          <td style="padding:16px 0 0;font-size:14px;line-height:22px;color:#6b7280;">Tax</td>
          <td align="right" style="padding:16px 0 0;font-size:14px;line-height:22px;color:#111827;">${taxLabel}</td>
        </tr>`
      : "";
  const supportLine = input.supportUrl
    ? `Questions? Contact us at <a href="${input.supportUrl}" style="color:#635bff;text-decoration:none;font-weight:600;">support</a>${input.supportEmail ? ` or <a href="mailto:${encodedSupportEmail}" style="color:#635bff;text-decoration:none;font-weight:600;">${escapeHtml(input.supportEmail)}</a>` : ""}${input.supportPhone ? ` or call us at ${escapeHtml(input.supportPhone)}` : ""}.`
    : input.supportEmail
      ? `Questions? Contact us at <a href="mailto:${encodedSupportEmail}" style="color:#635bff;text-decoration:none;font-weight:600;">${escapeHtml(input.supportEmail)}</a>${input.supportPhone ? ` or call us at ${escapeHtml(input.supportPhone)}` : ""}.`
      : input.supportPhone
        ? `Questions? Call us at ${escapeHtml(input.supportPhone)}.`
        : "Need help? Reply to this email and our team will take it from there.";
  const downloadActionsHtml = `
            <tr>
              <td style="padding:16px 0 0;font-size:14px;line-height:22px;color:#6b7280;">
                ${input.invoiceDownloadUrl
                  ? `<a href="${input.invoiceDownloadUrl}" style="color:#6b7280;text-decoration:none;font-weight:600;">Download invoice</a>`
                  : `<span style="color:#9ca3af;">Invoice attached</span>`}
              </td>
              <td style="padding:16px 0 0 20px;font-size:14px;line-height:22px;color:#6b7280;">
                ${input.receiptDownloadUrl
                  ? `<a href="${input.receiptDownloadUrl}" style="color:#6b7280;text-decoration:none;font-weight:600;">Download receipt</a>`
                  : `<span style="color:#9ca3af;">Receipt attached</span>`}
              </td>
            </tr>`;

  const result = await sendWithResend({
    to: input.to,
    subject: `Your receipt from ${input.providerName} #${input.receiptNumber}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Receipt for ${input.invoiceNumber}</title>
</head>
<body style="margin:0;padding:0;background:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000000;padding:48px 16px 40px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr>
          <td align="center" style="padding:0 0 22px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="width:24px;height:24px;border-radius:12px;background:#111827;color:#ffffff;font-size:13px;font-weight:700;text-align:center;line-height:24px;">A</td>
                <td style="padding-left:10px;font-size:14px;line-height:24px;font-weight:600;color:#ffffff;">${escapedProviderName}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding-bottom:20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;">
              <tr>
                <td style="padding:30px 30px 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="vertical-align:top;">
                        <div style="font-size:13px;line-height:20px;font-weight:600;color:#6b7280;">Receipt from ${escapedProviderName}</div>
                        <div style="margin-top:8px;font-size:42px;line-height:44px;font-weight:700;letter-spacing:-0.03em;color:#111827;">${totalLabel}</div>
                        <div style="margin-top:10px;font-size:14px;line-height:22px;color:#6b7280;">Paid ${paidAt}</div>
                      </td>
                      <td align="right" style="vertical-align:top;padding-left:16px;">
                        <table cellpadding="0" cellspacing="0" style="width:74px;height:74px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
                          <tr><td style="padding:10px 11px;vertical-align:top;">
                            <div style="width:14px;height:6px;border-radius:3px;background:#d1d5db;"></div>
                            <div style="width:7px;height:7px;border-radius:50%;background:#e5e7eb;margin-top:6px;"></div>
                            <div style="width:40px;height:4px;border-radius:2px;background:#eceff3;margin-top:8px;"></div>
                            <div style="width:34px;height:4px;border-radius:2px;background:#eceff3;margin-top:6px;"></div>
                            <div style="width:42px;height:4px;border-radius:2px;background:#eceff3;margin-top:6px;"></div>
                            <div style="width:30px;height:4px;border-radius:2px;background:#eceff3;margin-top:6px;"></div>
                          </td></tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid #eceff1;">
                    ${downloadActionsHtml}
                  </table>
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
                    <tr>
                      <td style="padding:0 0 8px;font-size:14px;line-height:22px;color:#6b7280;">Receipt number</td>
                      <td align="right" style="padding:0 0 8px;font-size:14px;line-height:22px;color:#111827;">${escapedReceiptNumber}</td>
                    </tr>
                    <tr>
                      <td style="padding:0 0 8px;font-size:14px;line-height:22px;color:#6b7280;">Invoice number</td>
                      <td align="right" style="padding:0 0 8px;font-size:14px;line-height:22px;color:#111827;">${escapedInvoiceNumber}</td>
                    </tr>
                    <tr>
                      <td style="padding:0;font-size:14px;line-height:22px;color:#6b7280;">Payment method</td>
                      <td align="right" style="padding:0;font-size:14px;line-height:22px;color:#111827;">${escapedPaymentMethod}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;">
            <tr>
              <td style="padding:30px;">
                <div style="font-size:16px;line-height:24px;font-weight:700;color:#111827;">Receipt #${escapedReceiptNumber}</div>
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  ${lineItemsHtml}
                </table>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eceff1;">
                  <tr>
                    <td style="padding:18px 0 0;font-size:14px;line-height:22px;font-weight:600;color:#111827;">Subtotal</td>
                    <td align="right" style="padding:18px 0 0;font-size:14px;line-height:22px;font-weight:600;color:#111827;">${subtotalLabel}</td>
                  </tr>
                  ${taxRow}
                  <tr>
                    <td style="padding:16px 0 0;font-size:14px;line-height:22px;font-weight:700;color:#111827;">Total</td>
                    <td align="right" style="padding:16px 0 0;font-size:14px;line-height:22px;font-weight:700;color:#111827;">${totalLabel}</td>
                  </tr>
                </table>
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #eceff1;">
                  <tr>
                    <td style="padding:18px 0 0;font-size:15px;line-height:24px;font-weight:700;color:#111827;">Amount paid</td>
                    <td align="right" style="padding:18px 0 0;font-size:15px;line-height:24px;font-weight:700;color:#111827;">${amountPaidLabel}</td>
                  </tr>
                </table>
                <div style="margin-top:22px;padding-top:18px;border-top:1px solid #eceff1;font-size:14px;line-height:22px;color:#6b7280;">
                  ${supportLine}
                </div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr>
          <td align="center" style="padding-top:24px;font-size:12px;line-height:18px;color:#8b8b93;">
            Powered by <span style="font-weight:700;color:#ffffff;">ArcenPay</span> Billing
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
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
