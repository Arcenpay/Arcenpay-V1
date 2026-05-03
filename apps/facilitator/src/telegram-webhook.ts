// ============================================================
//  Facilitator — Telegram Webhook Handler
//  Receives Approve/Deny callbacks from Telegram inline buttons
//  and dispatches top-up transactions accordingly.
// ============================================================

import type { Request, Response } from "express";

interface PendingApproval {
  requestId: string;
  status: "approved" | "denied" | "pending";
  agentAddress: string;
  amount: string;
  chatId: string;
  botToken: string;
  resolvedAt?: number;
}

// In-memory store (replace with Redis in production)
const approvals = new Map<string, PendingApproval>();

export function getPendingApproval(requestId: string): PendingApproval | undefined {
  return approvals.get(requestId);
}

export function storePendingApproval(approval: PendingApproval): void {
  approvals.set(approval.requestId, approval);
}

export function clearApproval(requestId: string): void {
  approvals.delete(requestId);
}

export function getAllPendingApprovals(): PendingApproval[] {
  return Array.from(approvals.values()).filter((a) => a.status === "pending");
}

export async function handleTelegramWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const body = req.body;

    // Handle callback_query (inline button press)
    if (body.callback_query) {
      const { id: callbackId, data, message } = body.callback_query;
      const chatId = message?.chat?.id?.toString();

      if (!data || !chatId) {
        res.status(200).json({ ok: true });
        return;
      }

      // Parse callback_data: "arcenpay:approve:requestId" or "arcenpay:deny:requestId"
      const parts = String(data).split(":");
      if (parts.length !== 3 || parts[0] !== "arcenpay") {
        await answerCallback(callbackId, "Unknown action");
        res.status(200).json({ ok: true });
        return;
      }

      const [, action, requestId] = parts;
      const approval = approvals.get(requestId);
      const botToken = approval?.botToken;

      if (!approval) {
        await answerCallback(callbackId, "This request has expired", botToken);
        res.status(200).json({ ok: true });
        return;
      }

      if (action === "approve") {
        approval.status = "approved";
        approval.resolvedAt = Date.now();
        await answerCallback(callbackId, "Approved! Top-up will be executed shortly.", botToken);
        console.log(`[TelegramWebhook] Request ${requestId} APPROVED by chat ${approval.chatId}`);
      } else if (action === "deny") {
        approval.status = "denied";
        approval.resolvedAt = Date.now();
        await answerCallback(callbackId, "Denied. No funds will be transferred.", botToken);
        console.log(`[TelegramWebhook] Request ${requestId} DENIED by chat ${approval.chatId}`);
      }

      res.status(200).json({ ok: true });
      return;
    }

    // Handle regular messages (for testing / debugging)
    if (body.message) {
      const chatId = body.message.chat?.id?.toString();
      const text = body.message?.text || "";

      if (text.startsWith("/start")) {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken && chatId) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: "👋 Welcome to ArcenPay Agent!\n\nI send top-up approval requests when your agent needs funds. You can approve or deny directly from the buttons I send.",
            }),
          });
        }
      }

      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[TelegramWebhook] Error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}

async function answerCallback(
  callbackId: string,
  text: string,
  botToken?: string,
): Promise<void> {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackId,
        text,
        show_alert: false,
      }),
    });
  } catch {
    // Silently fail — non-critical
  }
}
