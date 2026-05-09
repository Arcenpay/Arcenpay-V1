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
          <h2>Welcome to ${this.brandName}! 🎉</h2>
          <p>Your subscription is now active.</p>
          <table style="border-collapse:collapse;width:100%;max-width:400px">
            <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Plan</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${data.planTier || "Pro"}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Wallet</strong></td><td style="padding:8px;border-bottom:1px solid #eee"><code>${shortAddr}</code></td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Expires</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${data.expiresAt || "N/A"}</td></tr>
            <tr><td style="padding:8px"><strong>Token ID</strong></td><td style="padding:8px">#${data.tokenId || "—"}</td></tr>
          </table>
          <p style="margin-top:16px;color:#888">Transaction: <a href="${data.explorerUrl || "#"}">${data.txHash?.slice(0, 16) || ""}...</a></p>
        `,
        },

        renewal_receipt: {
          subject: `${this.brandName} — Subscription Renewed`,
          body: `
          <h2>Subscription Renewed ✅</h2>
          <p>Your subscription has been automatically renewed.</p>
          <table style="border-collapse:collapse;width:100%;max-width:400px">
            <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Amount</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${data.amount || "0"} USDC</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>New Expiry</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${data.expiresAt || "N/A"}</td></tr>
            <tr><td style="padding:8px"><strong>Wallet</strong></td><td style="padding:8px"><code>${shortAddr}</code></td></tr>
          </table>
          <p style="margin-top:16px;color:#888">Transaction: <a href="${data.explorerUrl || "#"}">${data.txHash?.slice(0, 16) || ""}...</a></p>
        `,
        },

        payment_failed: {
          subject: `⚠️ ${this.brandName} — Payment Failed`,
          body: `
          <h2>Payment Failed ⚠️</h2>
          <p>We were unable to process your subscription renewal.</p>
          <p><strong>Reason:</strong> ${data.reason || "Insufficient balance"}</p>
          <p><strong>Wallet:</strong> <code>${shortAddr}</code></p>
          <p>Please ensure your smart account has sufficient USDC balance to avoid service interruption.</p>
        `,
        },

        subscription_expiring: {
          subject: `${this.brandName} — Subscription Expiring Soon`,
          body: `
          <h2>Subscription Expiring Soon ⏰</h2>
          <p>Your subscription will expire on <strong>${data.expiresAt || "soon"}</strong>.</p>
          <p>Please ensure your wallet has sufficient balance for automatic renewal, or renew manually.</p>
          <p><strong>Wallet:</strong> <code>${shortAddr}</code></p>
        `,
        },

        access_revoked: {
          subject: `${this.brandName} — Access Revoked`,
          body: `
          <h2>Access Revoked</h2>
          <p>Your subscription has been cancelled and access has been revoked.</p>
          <p><strong>Token ID:</strong> #${data.tokenId || "—"}</p>
          <p><strong>Wallet:</strong> <code>${shortAddr}</code></p>
          <p>You can re-subscribe at any time to restore access.</p>
        `,
        },

        low_session_balance: {
          subject: `⚠️ ${this.brandName} — Low Session Balance`,
          body: `
          <h2>Low Session Balance ⚠️</h2>
          <p>Your ZKVUB session vault balance is running low.</p>
          <table style="border-collapse:collapse;width:100%;max-width:400px">
            <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Remaining</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${data.remaining || "0"} USDC</td></tr>
            <tr><td style="padding:8px"><strong>Session ID</strong></td><td style="padding:8px"><code>${data.sessionId?.slice(0, 16) || ""}...</code></td></tr>
          </table>
          <p>Please deposit additional USDC to avoid service interruption.</p>
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
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a2e;background:#fafafa">
        <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
          ${body}
        </div>
        <div style="text-align:center;margin-top:24px;font-size:12px;color:#999">
          <p>${this.brandName} — MEAP + ZKVUB Protocol</p>
          <p>Powered by on-chain entitlements</p>
        </div>
      </body>
      </html>
    `;
  }
}
