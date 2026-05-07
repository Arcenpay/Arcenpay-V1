import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@arcenpay/node";

/**
 * POST /api/webhook
 *
 * ArcenPay webhook receiver. Add this URL to your ArcenPay dashboard
 * under Settings → Webhooks.
 *
 * Signature format (sent by ArcenPay):
 *   X-MEAP-Signature: sha256=<hmac-hex>
 *   X-MEAP-Event:     <event-type>
 *   X-MEAP-Timestamp: <unix-seconds>
 *
 * Set ARCENPAY_WEBHOOK_SECRET in .env.local (the full whsec_... value).
 * The whsec_ prefix is stripped automatically before verifying.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // ── Signature verification ─────────────────────────────────────────────────
  const secret = process.env.ARCENPAY_WEBHOOK_SECRET ?? "";
  if (secret) {
    // ArcenPay sends: X-MEAP-Signature: sha256=<hex>
    const sigHeader = req.headers.get("x-meap-signature") ?? "";
    const sigHex = sigHeader.startsWith("sha256=")
      ? sigHeader.slice("sha256=".length)
      : sigHeader;

    if (!sigHex) {
      console.warn("[webhook] ❌ Missing X-MEAP-Signature header — rejected.");
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }

    try {
      if (!verifyWebhookSignature(rawBody, sigHex, secret)) {
        console.warn("[webhook] ❌ Signature mismatch — rejected.");
        console.debug("[webhook] Headers:", Object.fromEntries(req.headers));
        console.debug("[webhook] Received sig (hex part):", sigHex);
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    } catch (err) {
      console.error("[webhook] ❌ Signature verification error:", err);
      return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
    }
  } else {
    console.warn("[webhook] ⚠️ ARCENPAY_WEBHOOK_SECRET not set — skipping signature check.");
  }

  // ── Parse & log the event ──────────────────────────────────────────────────
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

  const meapEvent = req.headers.get("x-meap-event") ?? String(eventType);
  const meapTs = req.headers.get("x-meap-timestamp") ?? "";

  console.log(
    `[webhook] ✅ Received: ${meapEvent}${meapTs ? ` (ts=${meapTs})` : ""}`,
    JSON.stringify(event, null, 2),
  );

  return NextResponse.json({ received: true, event: meapEvent });
}
