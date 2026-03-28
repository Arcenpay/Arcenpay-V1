/**
 * Outbound webhook delivery for ArcenPay events.
 *
 * Fires a signed HTTP POST to the team's configured webhook URL whenever
 * a key event occurs (plan change, company created, etc.).
 *
 * Always call fire-and-forget: deliverWebhook(...).catch(() => {})
 * This never blocks the request that triggered the event.
 */

import { createHmac, randomBytes } from "crypto";
import { db } from "@/lib/db";

export async function deliverWebhook(
  teamId: string,
  eventName: string,
  data: Record<string, unknown>,
): Promise<void> {
  // Load provider profile
  const profile = await db.providerProfile.findUnique({
    where: { teamId },
    select: {
      webhookUrl: true,
      webhookSigningSecret: true,
      notifyWebhook: true,
      notificationPreferences: true,
    },
  });

  if (!profile?.notifyWebhook || !profile.webhookUrl) return;

  // Check if this specific event type is enabled in subscriptions
  const prefs = Array.isArray(profile.notificationPreferences)
    ? (profile.notificationPreferences as Array<{ id: string; webhook?: boolean }>)
    : [];

  // If the team has subscriptions configured, only send if this event is enabled.
  // If no subscriptions are configured (empty array), send all events.
  if (prefs.length > 0) {
    const sub = prefs.find((p) => p.id === eventName);
    if (sub && sub.webhook === false) return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    event: eventName,
    created: new Date().toISOString(),
    data,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ArcenPay-Webhook/1.0",
    "X-MEAP-Event": eventName,
    "X-MEAP-Timestamp": String(timestamp),
  };

  if (profile.webhookSigningSecret) {
    const sig = createHmac("sha256", profile.webhookSigningSecret)
      .update(payload)
      .digest("hex");
    headers["X-MEAP-Signature"] = `sha256=${sig}`;
  }

  const deliveryId = randomBytes(12).toString("hex");
  let statusCode: number | undefined;
  let success = false;
  let error: string | undefined;

  try {
    const res = await fetch(profile.webhookUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    statusCode = res.status;
    success = res.ok;
    if (!res.ok) error = `Endpoint returned ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Log delivery (non-blocking — we don't await this promise chain)
  db.webhookDelivery
    .create({
      data: {
        teamId,
        deliveryId,
        event: eventName,
        url: profile.webhookUrl,
        statusCode: statusCode ?? null,
        attemptNumber: 1,
        deliveredAt: new Date(),
        success,
        error: error ?? null,
        payload: JSON.parse(payload),
      },
    })
    .catch(() => {});
}
