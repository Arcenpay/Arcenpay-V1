import { NextRequest, NextResponse } from "next/server";
import { sendWebhookDelivery } from "@/lib/deliver-webhook";
import { db } from "@/lib/db";
import { requireTeamRoles, isErrorResponse } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  void request;
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

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
      return NextResponse.json(
        { error: "No webhook URL configured" },
        { status: 400 },
      );
    }

    return NextResponse.json({
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
    console.error("[api/webhooks/test] Direct delivery failed:", err);
    return NextResponse.json(
      {
        error: "Could not deliver webhook",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
