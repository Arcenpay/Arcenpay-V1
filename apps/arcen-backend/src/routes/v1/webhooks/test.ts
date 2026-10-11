import type { Context } from "hono";
import { z } from "zod";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { sendWebhookDelivery } from "../../../lib/webhooks/deliver-webhook.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";
import { assertSafeOutboundUrl } from "../../../lib/security/ssrf-guard.js";

const testWebhookSchema = z.object({
  url: z
    .string()
    .url("Invalid webhook URL")
    .refine(
      (url) => url.startsWith("https://"),
      "Webhook URL must use HTTPS (http:// is not allowed)",
    ),
});

export async function testWebhook(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = testWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      400 as any,
    );
  }

  const { team } = auth;

  const safeUrl = await assertSafeOutboundUrl(parsed.data.url);
  if (!safeUrl.ok) {
    return c.json(
      {
        ok: false,
        error: `Webhook URL rejected: ${safeUrl.reason}`,
        code: "INVALID_WEBHOOK_URL",
      },
      400 as any,
    );
  }

  const result = await sendWebhookDelivery({
    teamId: team.teamId,
    environmentId: activeEnvironment.id,
    webhookUrl: parsed.data.url,
    eventName: "webhook.test",
    force: true,
    data: {
      message: "Test webhook from ArcenPay",
      teamId: team.teamId,
      triggeredAt: new Date().toISOString(),
    },
  });

  if (!result) {
    return c.json(
      {
        ok: false,
        error:
          "Could not deliver test webhook. Ensure a webhook signing secret is configured and the URL uses HTTPS.",
      },
      400 as any,
    );
  }

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: team.teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.webhook.test",
    resourceType: "ProviderProfile",
    resourceId: team.teamId,
    afterData: {
      deliveryId: result.deliveryId,
      url: result.url,
      success: result.success,
      statusCode: result.statusCode,
      error: result.error,
    },
  });

  return c.json({
    ok: result.success,
    status: result.statusCode ?? undefined,
    message: result.success
      ? "Test webhook delivered"
      : result.error || "Test webhook failed",
    error: result.success ? undefined : result.error || "Test webhook failed",
  });
}
