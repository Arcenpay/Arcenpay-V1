import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "@/lib/config";
import { db } from "@/lib/db";

const TEST_PAYLOAD = {
  event: "webhook.test",
  created: new Date().toISOString(),
  data: {
    message: "This is a test webhook from ArcenPay",
    source: "dashboard",
  },
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

  // ── Try facilitator first ─────────────────────────────────────────────────
  try {
    const upstream = await fetch(`${FACILITATOR_URL}/api/webhooks/test`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        ...(body
          ? {
              "Content-Type":
                request.headers.get("content-type") || "application/json",
            }
          : {}),
        ...(FACILITATOR_SECRET
          ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
          : {}),
      },
      ...(body ? { body } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(3000), // 3 s timeout so we fall through quickly
    });

    const text = await upstream.text();
    if (upstream.status === 503 && text.includes("Webhooks not configured")) {
      // Facilitator is running but its own global webhooks are not set up.
      // Fall through to direct delivery for the provider's own webhook.
      throw new Error("Facilitator not configured");
    }

    const response = new NextResponse(text, { status: upstream.status });
    const contentType = upstream.headers.get("content-type");
    if (contentType) response.headers.set("content-type", contentType);
    return response;
  } catch (err) {
    // Facilitator is unavailable or unconfigured — fall through to direct delivery
    console.log(
      "[api/webhooks/test] Facilitator fallback triggered:",
      err instanceof Error ? err.message : "Service error",
    );
  }

  // ── Direct fallback: POST straight to the webhook URL ────────────────────
  // Resolve the webhook URL: prefer the one sent in the request body,
  // then fall back to whatever is saved in the provider profile.
  let webhookUrl =
    typeof reqPayload.url === "string" ? reqPayload.url.trim() : "";
  let signingSecret =
    typeof reqPayload.secret === "string" ? reqPayload.secret.trim() : "";

  if (!webhookUrl) {
    // Load from DB
    const teamCtx = await resolveTeamContext(session);
    const teamId = teamCtx?.teamId;
    if (teamId) {
      const profile = await db.providerProfile.findUnique({
        where: { teamId },
        select: { webhookUrl: true, webhookSigningSecret: true },
      });
      if (profile?.webhookUrl) webhookUrl = profile.webhookUrl;
      if (profile?.webhookSigningSecret)
        signingSecret = profile.webhookSigningSecret;
    }
  }

  if (!webhookUrl) {
    return NextResponse.json(
      { error: "No webhook URL configured" },
      { status: 400 },
    );
  }

  // Build payload
  const payload = JSON.stringify({
    ...TEST_PAYLOAD,
    created: new Date().toISOString(), // fresh timestamp each call
  });

  // Sign with HMAC-SHA256 if a secret is available
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ArcenPay-Webhook/1.0",
    "X-MEAP-Event": "webhook.test",
    "X-MEAP-Timestamp": String(Math.floor(Date.now() / 1000)),
  };
  if (signingSecret) {
    const sig = createHmac("sha256", signingSecret)
      .update(payload)
      .digest("hex");
    headers["X-MEAP-Signature"] = `sha256=${sig}`;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      message: res.ok
        ? "Test webhook delivered successfully"
        : `Webhook endpoint returned ${res.status}`,
      direct: true, // indicates facilitator was bypassed
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
