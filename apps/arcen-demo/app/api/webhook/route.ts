import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@arcenpay/node/webhooks";

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
 * Set ARCENPAY_WEBHOOK_SECRET in .env.local using the exact secret shown in
 * the dashboard. The handler also tolerates the common mistake of pasting only
 * the raw value without the `whsec_` prefix.
 *
 * ⚠️ Webhooks are REJECTED with HTTP 500 if ARCENPAY_WEBHOOK_SECRET
 * is not configured. There is no bypass — this is intentional.
 */

const MAX_TIMESTAMP_TOLERANCE_SEC = 300; // 5 minutes
const SIGNATURE_PREFIX = "sha256=";
const WEBHOOK_SECRET_PREFIX = "whsec_";

function getSecretCandidates(raw: string | undefined): string[] {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return [];

  return trimmed.startsWith(WEBHOOK_SECRET_PREFIX)
    ? [trimmed, trimmed.slice(WEBHOOK_SECRET_PREFIX.length)].filter(Boolean)
    : [trimmed, `${WEBHOOK_SECRET_PREFIX}${trimmed}`];
}

function normalizeSignatureHeader(raw: string | null): string {
  const trimmed = raw?.trim() ?? "";
  return trimmed.startsWith(SIGNATURE_PREFIX)
    ? trimmed.slice(SIGNATURE_PREFIX.length)
    : trimmed;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // ── 1. Require webhook secret ────────────────────────────────────────────────
  const secretCandidates = getSecretCandidates(
    process.env.ARCENPAY_WEBHOOK_SECRET,
  );
  if (secretCandidates.length === 0) {
    console.error(
      "[webhook] ❌ ARCENPAY_WEBHOOK_SECRET not configured — rejecting all webhooks.",
    );
    return NextResponse.json(
      { error: "Webhook secret not configured on server" },
      { status: 500 },
    );
  }

  // ── 2. Require signature header ──────────────────────────────────────────────
  const sigHex = normalizeSignatureHeader(
    req.headers.get("x-arcenpay-signature"),
  );

  if (!sigHex) {
    console.warn("[webhook] ❌ Missing X-ArcenPay-Signature header — rejected.");
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  if (!/^[0-9a-f]{64}$/i.test(sigHex)) {
    console.warn("[webhook] ❌ Malformed X-ArcenPay-Signature header — rejected.");
    return NextResponse.json({ error: "Malformed signature" }, { status: 401 });
  }

  // ── 3. Verify HMAC-SHA256 signature ──────────────────────────────────────────
  try {
    const matchedSecret = secretCandidates.find((secret) =>
      verifyWebhookSignature(rawBody, sigHex, secret),
    );

    if (!matchedSecret) {
      console.warn("[webhook] ❌ Signature mismatch — rejected.");
      console.debug("[webhook] Headers:", Object.fromEntries(req.headers));
      console.debug("[webhook] Received sig (hex part):", sigHex);
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 },
      );
    }

    if (
      process.env.ARCENPAY_WEBHOOK_SECRET?.trim() &&
      matchedSecret !== process.env.ARCENPAY_WEBHOOK_SECRET.trim()
    ) {
      console.warn(
        "[webhook] Verified using a compatibility secret variant. Update ARCENPAY_WEBHOOK_SECRET to the full dashboard value.",
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
  const arcenTs = req.headers.get("x-arcenpay-timestamp");
  if (arcenTs) {
    const ts = Number.parseInt(arcenTs, 10);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(ts) || ts <= 0) {
      console.warn("[webhook] ❌ Invalid X-ArcenPay-Timestamp — rejected.");
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

  const arcenEvent = req.headers.get("x-arcenpay-event") ?? String(eventType);

  console.log(
    `[webhook] ✅ Received: ${arcenEvent}${arcenTs ? ` (ts=${arcenTs})` : ""}`,
    JSON.stringify(event, null, 2),
  );

  return NextResponse.json({ received: true, event: arcenEvent });
}
