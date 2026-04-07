import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { sendWebhookDelivery } from "@/lib/deliver-webhook";

const TEST_PAYLOAD = {
  companyId: "test_company",
  planId: "starter",
  planName: "Starter",
  previousPlanId: "free",
  source: "dashboard.test",
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.text();
  let reqPayload: { url?: string; secret?: string } = {};
  try {
    reqPayload = body ? JSON.parse(body) : {};
  } catch {
    // ignore parse errors
  }

  const teamCtx = await resolveTeamContext(session);
  if (!teamCtx) {
    return NextResponse.json({ error: "No team found" }, { status: 403 });
  }

  try {
    const result = await sendWebhookDelivery({
      teamId: teamCtx.teamId,
      eventName: "company.plan.changed",
      data: TEST_PAYLOAD,
      webhookUrl:
        typeof reqPayload.url === "string" ? reqPayload.url.trim() : undefined,
      signingSecret:
        typeof reqPayload.secret === "string"
          ? reqPayload.secret.trim()
          : undefined,
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
