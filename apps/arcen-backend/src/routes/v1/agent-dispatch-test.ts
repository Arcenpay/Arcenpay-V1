/**
 * POST /api/v1/agent/dispatch/test — Send a test message to a dispatch provider
 *
 * The provider object carries all its own credentials (botToken, chatId, webhookUrl, email).
 */

import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";

export async function POST(c: Context) {
  const ctx = await requirePermission(c, "catalog:write");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  let body: {
    provider: {
      type: string;
      botToken?: string;
      chatId?: string;
      webhookUrl?: string;
      email?: string;
    };
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Invalid JSON body" }, 400 as any);
  }

  const { provider } = body;

  if (!provider || !provider.type) {
    return c.json({ message: "provider.type is required" }, 400 as any);
  }

  try {
    switch (provider.type) {
      case "telegram": {
        const botToken = provider.botToken;
        const chatId = provider.chatId;
        if (!botToken) {
          return c.json({ message: "Bot Token is required for Telegram" }, 400 as any);
        }
        if (!chatId) {
          return c.json({ message: "Chat ID is required for Telegram" }, 400 as any);
        }

        const message = `<b>✅ ArcenPay Agent — Test Message</b>\n\n` +
          `This confirms your dispatch provider is working correctly!\n\n` +
          `<b>Time:</b> ${new Date().toLocaleString()}\n\n` +
          `<i>You will receive top-up approval requests here when your agent needs funds.</i>`;

        const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const tgRes = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: "✅ Working!", callback_data: "arcenpay:test:ok" },
              ]],
            },
          }),
        });

        if (!tgRes.ok) {
          const tgBody = await tgRes.text();
          return c.json({ message: `Telegram API error: ${tgRes.status}. ${tgBody.slice(0, 200)}` }, 502 as any);
        }

        return c.json({
          message: "Test message sent successfully to Telegram! Check your chat.",
        });
      }

      case "discord": {
        const webhookUrl = provider.webhookUrl;
        if (!webhookUrl) {
          return c.json({ message: "Webhook URL is required for Discord" }, 400 as any);
        }
        const dcRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `✅ **ArcenPay Agent — Test Message**\nThis confirms your dispatch provider is working correctly!\nYou will receive top-up approval requests here.`,
          }),
        });

        if (!dcRes.ok) {
          return c.json({ message: `Discord webhook error: ${dcRes.status}` }, 502 as any);
        }

        return c.json({ message: "Test message sent successfully to Discord!" });
      }

      case "slack": {
        const webhookUrl = provider.webhookUrl;
        if (!webhookUrl) {
          return c.json({ message: "Webhook URL is required for Slack" }, 400 as any);
        }
        const slRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `✅ *ArcenPay Agent — Test Message*\nThis confirms your dispatch provider is working correctly!\nYou will receive top-up approval requests here.`,
          }),
        });

        if (!slRes.ok) {
          return c.json({ message: `Slack webhook error: ${slRes.status}` }, 502 as any);
        }

        return c.json({ message: "Test message sent successfully to Slack!" });
      }

      default:
        return c.json({ message: `Provider type "${provider.type}" does not support test messages yet.` }, 400 as any);
    }
  } catch (err: any) {
    return c.json({ message: `Failed to send test: ${err.message || "Unknown error"}` }, 500 as any);
  }
}
