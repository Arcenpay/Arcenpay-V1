import type { Context } from "hono";
import { sendWebhookDelivery } from "../../../lib/webhooks/deliver-webhook.js";
import { db } from "../../../db.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

export async function testWebhook(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const { team } = auth;

  try {
    const [company, plan] = await Promise.all([
      db.arcenCompany.findFirst({
        where: { teamId: team.teamId },
        orderBy: { lastSeenAt: "desc" },
        select: {
          id: true,
          name: true,
          activePlanId: true,
        },
      }),
      db.catalogPlan.findFirst({
        where: { teamId: team.teamId, status: "PUBLISHED" },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    const payload = {
      companyId: company?.id ?? null,
      companyName: company?.name ?? null,
      planId: company?.activePlanId ?? plan?.id ?? null,
      planName: plan?.name ?? null,
      previousPlanId: null,
      source: company || plan ? "dashboard.test.real_context" : "dashboard.test.synthetic_context",
    };

    const result = await sendWebhookDelivery({
      teamId: team.teamId,
      eventName: "company.plan.changed",
      data: payload,
      force: true,
    });

    if (!result) {
      return c.json({ error: "No webhook URL configured" }, 400 as any);
    }

    return c.json({
      ok: result.success,
      status: result.statusCode ?? undefined,
      event: "company.plan.changed",
      messageContext:
        payload.source === "dashboard.test.real_context"
          ? "Sent using current workspace company/plan context."
          : "Sent using synthetic fallback context because no company or published plan was found.",
      message: result.success
        ? "Test webhook delivered successfully"
        : `Webhook endpoint returned ${result.statusCode ?? "no response"}`,
    });
  } catch (err) {
    console.error("[webhooks/test] Direct delivery failed:", err);
    return c.json({
        error: "Could not deliver webhook",
        detail: err instanceof Error ? err.message : String(err),
      }, 502 as any);
  }
}
