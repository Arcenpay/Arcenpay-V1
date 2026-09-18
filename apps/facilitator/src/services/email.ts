// ============================================================
//  @arcenpay/node — Email Notification Service
//  Transactional email templates using Resend
//  PRD §9.2 — Email Notifications
// ============================================================

export interface EmailConfig {
  /** Resend API key */
  apiKey: string;
  /** Sender email address (e.g. noreply@arcenpay.io) */
  fromAddress: string;
  /** Provider brand name (injected into templates) */
  brandName?: string;
}

export interface EmailRecipient {
  email: string;
  walletAddress: string;
  name?: string;
}

export type EmailTemplate =
  | "welcome"
  | "renewal_receipt"
  | "payment_failed"
  | "subscription_expiring"
  | "access_revoked"
  | "low_session_balance";

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

/**
 * EmailService — Transactional email notifications via Resend API.
 *
 * Templates: Welcome, Renewal Receipt, Payment Failed,
 * Subscription Expiring, Access Revoked, Low Session Balance.
 *
 * PRD §9.2 — providers configure their Resend API key in Dashboard → Settings.
 */
export class EmailService {
  private apiKey: string;
  private fromAddress: string;
  private brandName: string;

  constructor(config: EmailConfig) {
    this.apiKey = config.apiKey;
    this.fromAddress = config.fromAddress;
    this.brandName = config.brandName || "ArcenPay";
  }

  /**
   * Send an email using a pre-defined template
   */
  async sendTemplate(
    template: EmailTemplate,
    recipient: EmailRecipient,
    data: Record<string, string>,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const payload = this.buildEmail(template, recipient, data);

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${this.brandName} <${this.fromAddress}>`,
          to: [payload.to],
          subject: payload.subject,
          html: payload.html,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`[Email] Failed to send ${template}:`, err);
        return { success: false, error: err };
      }

      const result = (await response.json()) as { id: string };
      console.log(
        `[Email] ✅ Sent ${template} to ${recipient.email} (${result.id})`,
      );
      return { success: true, messageId: result.id };
    } catch (err: any) {
      console.error(`[Email] Error sending ${template}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Build the email payload for a given template
   */
  private buildEmail(
    template: EmailTemplate,
    recipient: EmailRecipient,
    data: Record<string, string>,
  ): EmailPayload {
    const shortAddr = `${data.walletAddress?.slice(0, 6)}...${data.walletAddress?.slice(-4)}`;

    const templates: Record<EmailTemplate, { subject: string; body: string }> =
      {
        welcome: {
          subject: `Welcome to ${this.brandName}!`,
          body: `
          <h1 style="margin:0 0 10px;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">Welcome to ${this.brandName}</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#3f3f46;">Your subscription is now active on-chain.</p>
          <table style="border-collapse:collapse;width:100%;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;margin-bottom:20px;overflow:hidden;">
            <tr><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a;">Plan</td><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;font-weight:600;color:#0a0a0a;" align="right">${data.planTier || "Pro"}</td></tr>
            <tr><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a;">Wallet</td><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0a0a0a;" align="right">${shortAddr}</td></tr>
            <tr><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a;">Expires</td><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;font-weight:600;color:#0a0a0a;" align="right">${data.expiresAt || "N/A"}</td></tr>
            <tr><td style="padding:10px 16px;font-size:13px;color:#71717a;">Token ID</td><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#0a0a0a;" align="right">#${data.tokenId || "—"}</td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#71717a;">Transaction: <a href="${data.explorerUrl || "#"}" style="color:#0001fd;text-decoration:underline;font-weight:600;">${data.txHash?.slice(0, 16) || ""}...</a></p>
        `,
        },

        renewal_receipt: {
          subject: `${this.brandName} — Subscription Renewed`,
          body: `
          <div style="font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Automated Renewal</div>
          <h1 style="margin:0 0 10px;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">Subscription Renewed</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#3f3f46;">Your subscription has been automatically renewed for the next billing cycle.</p>
          <table style="border-collapse:collapse;width:100%;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;margin-bottom:20px;overflow:hidden;">
            <tr><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a;">Amount</td><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;font-weight:700;color:#0a0a0a;" align="right">${data.amount || "0"} USDC</td></tr>
            <tr><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a;">New Expiry</td><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;font-weight:600;color:#0a0a0a;" align="right">${data.expiresAt || "N/A"}</td></tr>
            <tr><td style="padding:10px 16px;font-size:13px;color:#71717a;">Wallet</td><td style="padding:10px 16px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0a0a0a;" align="right">${shortAddr}</td></tr>
          </table>
          <p style="margin:0 0 20px;font-size:13px;color:#71717a;">Transaction: <a href="${data.explorerUrl || `https://testnet.arcscan.app/tx/${data.txHash || ""}`}" target="_blank" rel="noopener noreferrer" style="color:#0001fd;text-decoration:underline;font-weight:600;">${data.txHash?.slice(0, 16) || ""}...</a></p>
          <div>
            <a href="http://localhost:3000/settings/billing" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 22px;background-color:#0a0a0a;color:#ffffff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
              View billing history &rarr;
            </a>
          </div>
        `,
        },

        payment_failed: {
          subject: `⚠️ ${this.brandName} — Payment Failed`,
          body: `
          <div style="font-size:11px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Action Required</div>
          <h1 style="margin:0 0 10px;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">Payment Failed</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#3f3f46;">We were unable to process your recurring subscription renewal.</p>
          <table style="border-collapse:collapse;width:100%;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;margin-bottom:20px;overflow:hidden;">
            <tr><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a;">Reason</td><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;font-weight:600;color:#ef4444;" align="right">${data.reason || "Insufficient balance"}</td></tr>
            <tr><td style="padding:10px 16px;font-size:13px;color:#71717a;">Wallet</td><td style="padding:10px 16px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0a0a0a;" align="right">${shortAddr}</td></tr>
          </table>
          <p style="margin:0 0 20px;font-size:13px;color:#71717a;">Please top up your wallet with USDC to prevent subscription interruption.</p>
          <div>
            <a href="http://localhost:3000/settings/billing" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 22px;background-color:#0a0a0a;color:#ffffff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
              Manage subscription &rarr;
            </a>
          </div>
        `,
        },

        subscription_expiring: {
          subject: `${this.brandName} — Subscription Expiring Soon`,
          body: `
          <h1 style="margin:0 0 10px;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">Subscription Expiring Soon</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#3f3f46;">Your subscription will expire on <strong style="color:#0a0a0a;">${data.expiresAt || "soon"}</strong>.</p>
          <table style="border-collapse:collapse;width:100%;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;margin-bottom:20px;overflow:hidden;">
            <tr><td style="padding:10px 16px;font-size:13px;color:#71717a;">Wallet</td><td style="padding:10px 16px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0a0a0a;" align="right">${shortAddr}</td></tr>
          </table>
          <p style="margin:0 0 20px;font-size:13px;color:#71717a;">Please ensure your wallet has sufficient balance for automated renewal.</p>
          <div>
            <a href="http://localhost:3000/settings/billing" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 22px;background-color:#0a0a0a;color:#ffffff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
              Renew subscription &rarr;
            </a>
          </div>
        `,
        },

        access_revoked: {
          subject: `${this.brandName} — Access Revoked`,
          body: `
          <h1 style="margin:0 0 10px;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">Access Revoked</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#3f3f46;">Your subscription has ended and entitlement access has been revoked.</p>
          <table style="border-collapse:collapse;width:100%;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;margin-bottom:20px;overflow:hidden;">
            <tr><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a;">Token ID</td><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;font-weight:600;color:#0a0a0a;" align="right">#${data.tokenId || "—"}</td></tr>
            <tr><td style="padding:10px 16px;font-size:13px;color:#71717a;">Wallet</td><td style="padding:10px 16px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0a0a0a;" align="right">${shortAddr}</td></tr>
          </table>
          <p style="margin:0 0 20px;font-size:13px;color:#71717a;">You can re-subscribe anytime from the platform dashboard to restore access.</p>
          <div>
            <a href="http://localhost:3000" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 22px;background-color:#0a0a0a;color:#ffffff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
              Re-subscribe now &rarr;
            </a>
          </div>
        `,
        },

        low_session_balance: {
          subject: `⚠️ ${this.brandName} — Low Session Balance`,
          body: `
          <div style="font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Low Balance Alert</div>
          <h1 style="margin:0 0 10px;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">Low Session Balance</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#3f3f46;">Your ZKVUB session vault balance is running low.</p>
          <table style="border-collapse:collapse;width:100%;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;margin-bottom:20px;overflow:hidden;">
            <tr><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a;">Remaining Balance</td><td style="padding:10px 16px;border-bottom:1px solid #e4e4e7;font-size:13px;font-weight:700;color:#0a0a0a;" align="right">${data.remaining || "0"} USDC</td></tr>
            <tr><td style="padding:10px 16px;font-size:13px;color:#71717a;">Session ID</td><td style="padding:10px 16px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0a0a0a;" align="right"><code>${data.sessionId?.slice(0, 16) || ""}...</code></td></tr>
          </table>
          <p style="margin:0 0 20px;font-size:13px;color:#71717a;">Please deposit additional USDC to avoid service interruption.</p>
          <div>
            <a href="http://localhost:3000/settings/billing" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 22px;background-color:#0a0a0a;color:#ffffff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
              Top up session vault &rarr;
            </a>
          </div>
        `,
        },
      };

    const tpl = templates[template];
    return {
      to: recipient.email,
      subject: tpl.subject,
      html: this.wrapInLayout(tpl.body),
    };
  }

  /**
   * Wrap template body in a consistent email layout
   */
  private wrapInLayout(body: string): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;max-width:560px;margin:0 auto;padding:40px 16px;color:#0a0a0a;background:#fafafa;">
        <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
          <!-- Header -->
          <div style="padding:28px 36px 20px 36px;background:#ffffff;">
            <img src="https://files.catbox.moe/dzpc14.png" alt="${this.brandName}" width="138" height="34" style="display:block;height:32px;width:auto;border:0;outline:none;" />
          </div>
          <!-- Divider -->
          <div style="height:1px;background-color:#f4f4f5;line-height:1px;">&nbsp;</div>
          <!-- Content -->
          <div style="padding:28px 36px 32px 36px;background:#ffffff;">
            ${body}
          </div>
          <!-- Footer -->
          <div style="padding:20px 36px 28px 36px;background:#fafafa;border-top:1px solid #f4f4f5;text-align:center;font-size:12px;color:#71717a;">
            <p style="margin:0 0 6px 0;">${this.brandName} &middot; Powered by ArcenPay Protocol</p>
            <p style="margin:0;font-size:11px;color:#a1a1aa;">&copy; 2026 ArcenPay Protocol. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
