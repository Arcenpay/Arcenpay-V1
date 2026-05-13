import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@arcenpay/node";

/**
 * POST /api/webhook
 *
 * ArcenPay webhook receiver. Add this URL to your ArcenPay dashboard
 * under Settings → Webhooks.
 *
 * Headers sent by ArcenPay:
 *   X-ArcenPay-Signature: sha256=<hmac-hex>
 *   X-ArcenPay-Event:     <event-type>
 *   X-ArcenPay-Timestamp: <unix-seconds>
 *
 * Set ARCENPAY_WEBHOOK_SECRET in .env.local. The whsec_ prefix is
 * stripped automatically before verifying.
 *
 * ⚠️ Webhooks are REJECTED with HTTP 500 if ARCENPAY_WEBHOOK_SECRET
 * is not configured. There is no bypass — this is intentional.
 */

const MAX_TIMESTAMP_TOLERANCE_SEC = 300; // 5 minutes

function extractSecret(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  return trimmed.startsWith("whsec_") ? trimmed.slice(6) : trimmed;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // ── 1. Require webhook secret ────────────────────────────────────────────────
  const secret = extractSecret(process.env.ARCENPAY_WEBHOOK_SECRET);
  if (!secret) {
    console.error(
      "[webhook] ❌ ARCENPAY_WEBHOOK_SECRET not configured — rejecting all webhooks.",
    );
    return NextResponse.json(
      { error: "Webhook secret not configured on server" },
      { status: 500 },
    );
  }

  // ── 2. Require signature header ──────────────────────────────────────────────
  const sigHeader = req.headers.get("x-arcenpay-signature") ?? "";
  const sigHex = sigHeader.startsWith("sha256=")
    ? sigHeader.slice("sha256=".length)
    : sigHeader;

  if (!sigHex) {
    console.warn("[webhook] ❌ Missing X-ArcenPay-Signature header — rejected.");
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // ── 3. Verify HMAC-SHA256 signature ──────────────────────────────────────────
  try {
    if (!verifyWebhookSignature(rawBody, sigHex, secret)) {
      console.warn("[webhook] ❌ Signature mismatch — rejected.");
      console.debug("[webhook] Headers:", Object.fromEntries(req.headers));
      console.debug("[webhook] Received sig (hex part):", sigHex);
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 },
      );
    }
  } catch (err) {
    console.error("[webhook] ❌ Signature verification error:", err);
    return NextResponse.json(
      { error: "Signature verification failed" },
      { status: 401 },
    );
  }

  // ── 4. Timestamp anti-replay check ───────────────────────────────────────────
  const meapTs = req.headers.get("x-arcenpay-timestamp");
  if (meapTs) {
    const ts = Number.parseInt(meapTs, 10);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(ts) || ts <= 0) {
      console.warn("[webhook] ❌ Invalid X-MEAP-Timestamp — rejected.");
      return NextResponse.json(
        { error: "Invalid timestamp" },
        { status: 401 },
      );
    }
    if (Math.abs(now - ts) > MAX_TIMESTAMP_TOLERANCE_SEC) {
      console.warn(
        `[webhook] ❌ Timestamp too old (diff=${now - ts}s, max=${MAX_TIMESTAMP_TOLERANCE_SEC}s) — rejected.`,
      );
      return NextResponse.json(
        { error: "Timestamp outside tolerance" },
        { status: 401 },
      );
    }
  }

  // ── Parse & log the event ────────────────────────────────────────────────────
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventType =
    typeof event === "object" && event !== null && "event" in event
      ? (event as Record<string, unknown>).event
      : "unknown";

  const meapEvent = req.headers.get("x-arcenpay-event") ?? String(eventType);

  console.log(
    `[webhook] ✅ Received: ${meapEvent}${meapTs ? ` (ts=${meapTs})` : ""}`,
    JSON.stringify(event, null, 2),
  );

  return NextResponse.json({ received: true, event: meapEvent });
}
