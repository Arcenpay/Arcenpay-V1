/**
 * POST /api/v1/agent/dispatch/test — Send a test message to a dispatch provider
 *
 * The provider object carries all its own credentials (botToken, chatId, webhookUrl, email).
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const ctx = await requirePermission("catalog:write");
  if (isErrorResponse(ctx)) return ctx;

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
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const { provider } = body;

  if (!provider || !provider.type) {
    return NextResponse.json(
      { message: "provider.type is required" },
      { status: 400 },
    );
  }

  try {
    switch (provider.type) {
      case "telegram": {
        const botToken = provider.botToken;
        const chatId = provider.chatId;
        if (!botToken) {
          return NextResponse.json({ message: "Bot Token is required for Telegram" }, { status: 400 });
        }
        if (!chatId) {
          return NextResponse.json({ message: "Chat ID is required for Telegram" }, { status: 400 });
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
          return NextResponse.json(
            { message: `Telegram API error: ${tgRes.status}. ${tgBody.slice(0, 200)}` },
            { status: 502 },
          );
        }

        return NextResponse.json({
          message: "Test message sent successfully to Telegram! Check your chat.",
        });
      }

      case "discord": {
        const webhookUrl = provider.webhookUrl;
        if (!webhookUrl) {
          return NextResponse.json({ message: "Webhook URL is required for Discord" }, { status: 400 });
        }
        const dcRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `✅ **ArcenPay Agent — Test Message**\nThis confirms your dispatch provider is working correctly!\nYou will receive top-up approval requests here.`,
          }),
        });

        if (!dcRes.ok) {
          return NextResponse.json(
            { message: `Discord webhook error: ${dcRes.status}` },
            { status: 502 },
          );
        }

        return NextResponse.json({ message: "Test message sent successfully to Discord!" });
      }

      case "slack": {
        const webhookUrl = provider.webhookUrl;
        if (!webhookUrl) {
          return NextResponse.json({ message: "Webhook URL is required for Slack" }, { status: 400 });
        }
        const slRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `✅ *ArcenPay Agent — Test Message*\nThis confirms your dispatch provider is working correctly!\nYou will receive top-up approval requests here.`,
          }),
        });

        if (!slRes.ok) {
          return NextResponse.json(
            { message: `Slack webhook error: ${slRes.status}` },
            { status: 502 },
          );
        }

        return NextResponse.json({ message: "Test message sent successfully to Slack!" });
      }

      default:
        return NextResponse.json(
          { message: `Provider type "${provider.type}" does not support test messages yet.` },
          { status: 400 },
        );
    }
  } catch (err: any) {
    return NextResponse.json(
      { message: `Failed to send test: ${err.message || "Unknown error"}` },
      { status: 500 },
    );
  }
}
