// ============================================================
//  Dashboard — Email helper (server-only)
//  Sends transactional emails via Resend.
//  https://resend.com/docs
// ============================================================

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || "noreply@arcenpay.xyz";
const APP_URL =
  process.env.NEXTAUTH_URL ??
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

/** Sends a magic link email for passwordless login */
export async function sendMagicLinkEmail(
  email: string,
  token: string,
): Promise<void> {
  const url = `${APP_URL}/api/auth/magic/verify?token=${token}`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "Sign in to ArcenPay",
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
            Your sign-in link
          </h1>
          <p style="margin:0 0 28px;font-size:14px;color:#888;">
            Click the button below to sign in to your ArcenPay Provider Dashboard.
            This link expires in <strong style="color:#ccc">15 minutes</strong> and can only be used once.
          </p>

          <!-- CTA button -->
          <a href="${url}"
             style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;
                    text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            Sign in to ArcenPay
          </a>

          <!-- Fallback URL -->
          <p style="margin:28px 0 0;font-size:12px;color:#555;">
            Or copy and paste this URL into your browser:<br />
            <a href="${url}" style="color:#6366f1;word-break:break-all;">${url}</a>
          </p>

          <hr style="margin:32px 0;border:none;border-top:1px solid #222225;" />
          <p style="margin:0;font-size:12px;color:#444;">
            If you didn't request this, you can safely ignore this email.
            Your account is not at risk.
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
  const url = `${APP_URL}/api/auth/magic/verify?token=${token}`;
  const inviterText = inviterEmail
    ? `<strong style="color:#ccc">${inviterEmail}</strong>`
    : "A team admin";

  await resend.emails.send({
    from: FROM,
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
            workspace on ArcenPay. Click the button below to accept and sign in.
            This link expires in <strong style="color:#ccc">15 minutes</strong>.
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
