// ============================================================
//  Facilitator — Telegram Webhook Handler
//  Receives Approve/Deny callbacks from Telegram inline buttons
//  and dispatches top-up transactions accordingly.
// ============================================================

import type { Request, Response } from "express";
import { secureCompare } from "./http-security.js";

interface PendingApproval {
  requestId: string;
  status: "approved" | "denied" | "pending";
  agentAddress: string;
  amount: string;
  chatId: string;
  botToken: string;
  resolvedAt?: number;
  /** Creation time (unix ms) — used to bound the in-memory store. */
  createdAt: number;
}

/**
 * Pending human approvals for agent top-ups.
 *
 * SECURITY/NOTE: entries expire so a hostile or merely noisy caller cannot grow
 * this map without bound (see `PENDING_APPROVAL_TTL_MS`). In a multi-replica
 * deployment this should move to Redis; the TTL and binding checks below are
 * written so that behaviour does not change when it does.
 */
const approvals = new Map<string, PendingApproval>();

/** How long a pending approval stays actionable. */
const PENDING_APPROVAL_TTL_MS = 15 * 60 * 1000;

/** Hard ceiling on concurrent pending approvals. */
const MAX_PENDING_APPROVALS = 1000;

function isExpired(approval: PendingApproval, now = Date.now()): boolean {
  return now - approval.createdAt > PENDING_APPROVAL_TTL_MS;
}

function purgeExpiredApprovals(): void {
  const now = Date.now();
  for (const [id, approval] of approvals) {
    if (isExpired(approval, now)) approvals.delete(id);
  }
}

export function getPendingApproval(requestId: string): PendingApproval | undefined {
  const approval = approvals.get(requestId);
  if (!approval) return undefined;
  if (isExpired(approval)) {
    approvals.delete(requestId);
    return undefined;
  }
  return approval;
}

export function storePendingApproval(approval: PendingApproval): void {
  purgeExpiredApprovals();
  if (approvals.size >= MAX_PENDING_APPROVALS) {
    // Fail closed: refuse to grow unbounded rather than evicting randomly,
    // which could drop an approval an operator is about to action.
    throw new Error(
      "Too many pending approvals in flight. Resolve or expire existing requests first.",
    );
  }
  approvals.set(approval.requestId, approval);
  const timer = setTimeout(
    () => approvals.delete(approval.requestId),
    PENDING_APPROVAL_TTL_MS,
  );
  if (typeof timer.unref === "function") timer.unref();
}

export function clearApproval(requestId: string): void {
  approvals.delete(requestId);
}

export function getAllPendingApprovals(): PendingApproval[] {
  purgeExpiredApprovals();
  return Array.from(approvals.values()).filter((a) => a.status === "pending");
}

/**
 * Verifies Telegram's shared webhook secret.
 *
 * SECURITY: without this, `POST /api/telegram/webhook` is completely anonymous —
 * anyone who can reach the facilitator can post a `callback_query` and flip a
 * pending top-up to `approved`, releasing agent funds. Telegram echoes a secret
 * token back in `X-Telegram-Bot-Api-Secret-Token`; register it with
 * `setWebhook({ secret_token })`.
 *
 * Behaviour:
 *  - secret configured → header must match (constant-time).
 *  - secret NOT configured → allowed only outside production, so local
 *    development with hand-crafted payloads keeps working. In production this
 *    fail-closes (the endpoint does not exist as an anonymous surface).
 */
function isAuthorizedTelegramCaller(req: Request): boolean {
  const expected = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[TelegramWebhook] Rejecting request: TELEGRAM_WEBHOOK_SECRET is not set. " +
          "Configure it and register it via Telegram setWebhook({ secret_token }).",
      );
      return false;
    }
    return true;
  }

  const provided = req.headers["x-telegram-bot-api-secret-token"];
  return secureCompare(
    typeof provided === "string" ? provided : undefined,
    expected,
  );
}

export async function handleTelegramWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    // ── Authenticate the caller BEFORE reading anything from the body ──────
    if (!isAuthorizedTelegramCaller(req)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

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
      const approval = getPendingApproval(requestId);
      const botToken = approval?.botToken;

      if (!approval) {
        await answerCallback(callbackId, "This request has expired", botToken);
        res.status(200).json({ ok: true });
        return;
      }

      // SECURITY: bind the button press to the chat the request was sent to.
      // Without this, anyone who learns a requestId can approve (or deny)
      // someone else's pending top-up, because the callback payload is not
      // tied to the approval record.
      if (approval.chatId && String(approval.chatId) !== String(chatId)) {
        console.warn(
          `[TelegramWebhook] Rejected callback for ${requestId}: chat mismatch.`,
        );
        await answerCallback(
          callbackId,
          "You are not allowed to action this request.",
          botToken,
        );
        res.status(403).json({ ok: false, error: "Forbidden" });
        return;
      }

      // Idempotency: a resolved request must not be re-actioned (e.g. a user
      // double-tapping must not flip a denial into an approval).
      if (approval.status !== "pending") {
        await answerCallback(
          callbackId,
          `This request was already ${approval.status}.`,
          botToken,
        );
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
      } else {
        await answerCallback(callbackId, "Unknown action", botToken);
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
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
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
