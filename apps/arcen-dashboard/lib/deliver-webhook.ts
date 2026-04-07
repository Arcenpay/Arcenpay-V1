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
import { toPrismaJson } from "@/lib/prisma-json";

export interface SendWebhookDeliveryInput {
  teamId: string;
  eventName: string;
  data: Record<string, unknown>;
  webhookUrl?: string | null;
  signingSecret?: string | null;
  force?: boolean;
}

export interface SendWebhookDeliveryResult {
  deliveryId: string;
  payload: Record<string, unknown>;
  success: boolean;
  statusCode: number | null;
  error: string | null;
  url: string;
}

async function resolveWebhookTarget(
  teamId: string,
  input: Pick<SendWebhookDeliveryInput, "webhookUrl" | "signingSecret" | "eventName" | "force">,
) {
  const profile = await db.providerProfile.findUnique({
    where: { teamId },
    select: {
      webhookUrl: true,
      webhookSigningSecret: true,
      notifyWebhook: true,
      notificationPreferences: true,
    },
  });

  const webhookUrl = input.webhookUrl?.trim() || profile?.webhookUrl || null;
  const signingSecret = input.signingSecret?.trim() || profile?.webhookSigningSecret || null;

  if (!webhookUrl) return null;
  if (!input.force && !profile?.notifyWebhook) return null;

  const prefs = Array.isArray(profile?.notificationPreferences)
    ? (profile.notificationPreferences as Array<{ id: string; webhook?: boolean }>)
    : [];

  if (!input.force && prefs.length > 0) {
    const sub = prefs.find((p) => p.id === input.eventName);
    if (sub && sub.webhook === false) return null;
  }

  return {
    webhookUrl,
    signingSecret,
  };
}

export async function sendWebhookDelivery(
  input: SendWebhookDeliveryInput,
): Promise<SendWebhookDeliveryResult | null> {
  const target = await resolveWebhookTarget(input.teamId, input);
  if (!target) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const payloadObject = {
    event: input.eventName,
    created: new Date().toISOString(),
    data: input.data,
  };
  const payload = JSON.stringify(payloadObject);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ArcenPay-Webhook/1.0",
    "X-MEAP-Event": input.eventName,
    "X-MEAP-Timestamp": String(timestamp),
  };

  if (target.signingSecret) {
    const sig = createHmac("sha256", target.signingSecret)
      .update(payload)
      .digest("hex");
    headers["X-MEAP-Signature"] = `sha256=${sig}`;
  }

  const deliveryId = randomBytes(12).toString("hex");
  let statusCode: number | undefined;
  let success = false;
  let error: string | undefined;

  try {
    const res = await fetch(target.webhookUrl, {
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
        teamId: input.teamId,
        deliveryId,
        event: input.eventName,
        url: target.webhookUrl,
        statusCode: statusCode ?? null,
        attemptNumber: 1,
        deliveredAt: new Date(),
        success,
        error: error ?? null,
        payload: toPrismaJson(payloadObject),
      },
    })
    .catch(() => {});

  return {
    deliveryId,
    payload: payloadObject,
    success,
    statusCode: statusCode ?? null,
    error: error ?? null,
    url: target.webhookUrl,
  };
}

export async function deliverWebhook(
  teamId: string,
  eventName: string,
  data: Record<string, unknown>,
): Promise<void> {
  await sendWebhookDelivery({
    teamId,
    eventName,
    data,
  });
}
