import { NextRequest, NextResponse } from "next/server";
import { sendWebhookDelivery } from "@/lib/deliver-webhook";
import { requireTeamRoles, isErrorResponse } from "@/lib/api-auth";

const TEST_PAYLOAD = {
  companyId: "test_company",
  planId: "starter",
  planName: "Starter",
  previousPlanId: "free",
  source: "dashboard.test",
};

export async function POST(request: NextRequest) {
  void request;
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const { team } = auth;

  try {
    const result = await sendWebhookDelivery({
      teamId: team.teamId,
      eventName: "company.plan.changed",
      data: TEST_PAYLOAD,
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
