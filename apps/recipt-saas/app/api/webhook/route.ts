import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@arcenpay/node/webhooks";

const MAX_TIMESTAMP_TOLERANCE_SEC = 300;
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

function shouldBypassVerificationInDev(secretCandidates: string[]): boolean {
  return process.env.NODE_ENV !== "production" && secretCandidates.length === 0;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const secretCandidates = getSecretCandidates(
    process.env.ARCENPAY_WEBHOOK_SECRET,
  );

  if (shouldBypassVerificationInDev(secretCandidates)) {
    console.warn(
      "[receipt webhook] ARCENPAY_WEBHOOK_SECRET is not set. Accepting webhook without signature verification in development.",
    );
  } else {
    if (secretCandidates.length === 0) {
      return NextResponse.json(
        { error: "Webhook secret not configured on server" },
        { status: 500 },
      );
    }

    const sigHex = normalizeSignatureHeader(
      req.headers.get("x-arcenpay-signature"),
    );
    if (!sigHex) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }
    if (!/^[0-9a-f]{64}$/i.test(sigHex)) {
      return NextResponse.json(
        { error: "Malformed signature" },
        { status: 401 },
      );
    }

    const matchedSecret = secretCandidates.find((secret) =>
      verifyWebhookSignature(rawBody, sigHex, secret),
    );
    if (!matchedSecret) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 },
      );
    }
  }

  const arcenTs = req.headers.get("x-arcenpay-timestamp");
  if (arcenTs) {
    const ts = Number.parseInt(arcenTs, 10);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(ts) || ts <= 0) {
      return NextResponse.json({ error: "Invalid timestamp" }, { status: 401 });
    }
    if (Math.abs(now - ts) > MAX_TIMESTAMP_TOLERANCE_SEC) {
      return NextResponse.json(
        { error: "Timestamp outside tolerance" },
        { status: 401 },
      );
    }
  }

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
    `[receipt webhook] received ${arcenEvent}${arcenTs ? ` (ts=${arcenTs})` : ""}`,
  );

  return NextResponse.json({
    received: true,
    event: arcenEvent,
    verified:
      secretCandidates.length > 0 || process.env.NODE_ENV === "production",
  });
}
