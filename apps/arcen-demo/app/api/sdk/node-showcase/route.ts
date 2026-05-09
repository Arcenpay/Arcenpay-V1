import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import {
  buildEventIdempotencyKey,
  createProtocolEvent,
  mapProtocolEventToBillingType,
  verifyWebhookSignature,
} from "@arcenpay/node";
import {
  getDemoCompanyIdentity,
  getDemoCompanyKeys,
  getDemoUserIdentity,
  getRawArcenClient,
} from "@/lib/arcen-client";
import { resolveArcenPayBaseUrl } from "@arcenpay/node";

const FEATURE_KEYS = ["scan", "api-access", "export-pdf"] as const;

function getNodeStatus() {
  return {
    hasApiKey: !!process.env.ARCENPAY_API_KEY,
    baseUrl: resolveArcenPayBaseUrl(),
    componentId: process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID ?? "",
    company: getDemoCompanyIdentity(),
    user: getDemoUserIdentity(),
  };
}

async function buildLiveSnapshot() {
  const client = getRawArcenClient();
  const company = getDemoCompanyKeys();
  const user = getDemoUserIdentity();

  const identify = await client.identify({
    company: getDemoCompanyIdentity(),
    user,
    expiresIn: 3600,
  });

  const [flag, entitlement, flags, companies] = await Promise.allSettled([
    client.checkFlag("api-access", company),
    client.checkEntitlement("scan", company),
    client.checkFlags([...FEATURE_KEYS], company),
    client.listCompanies({ limit: 5 }),
  ]);

  const accessToken = await client.createAccessToken(company, user, 1800);

  const companyDetails = identify.companyId
    ? await client.getCompany(identify.companyId).catch((error) => ({
        error:
          error instanceof Error ? error.message : "Failed to load company",
      }))
    : null;

  const rawPayload = JSON.stringify({
    event: "subscription.renewed",
    timestamp: 1_716_000_000,
    data: { companyId: identify.companyId, feature: "scan" },
  });
  const demoSecret = "whsec_demo_showcase";
  const signature = createHmac("sha256", demoSecret)
    .update(rawPayload)
    .digest("hex");
  const helperSignatureValid = verifyWebhookSignature(
    rawPayload,
    signature,
    demoSecret,
  );

  const idempotencyKey = buildEventIdempotencyKey("subscription.renewed", [
    identify.companyId,
    "starter",
    "2026-05",
  ]);
  const protocolEvent = createProtocolEvent(
    "subscription.renewed",
    {
      companyId: identify.companyId,
      planId: "starter",
      amountMicros: 9_00_000,
    },
    {
      source: "dashboard",
      idempotencyKey,
      chainId: 84532,
      occurredAt: "2026-05-07T10:30:00.000Z",
    },
  );

  return {
    identify,
    accessToken,
    flag:
      flag.status === "fulfilled"
        ? flag.value
        : {
            error:
              flag.reason instanceof Error ? flag.reason.message : "Failed",
          },
    entitlement:
      entitlement.status === "fulfilled"
        ? entitlement.value
        : {
            error:
              entitlement.reason instanceof Error
                ? entitlement.reason.message
                : "Failed",
          },
    flags:
      flags.status === "fulfilled"
        ? flags.value
        : {
            error:
              flags.reason instanceof Error ? flags.reason.message : "Failed",
          },
    companies:
      companies.status === "fulfilled"
        ? {
            count: companies.value.count,
            sample: companies.value.data.slice(0, 3).map((item) => ({
              id: item.id,
              name: item.name,
              activePlanId: item.activePlanId ?? null,
            })),
          }
        : {
            error:
              companies.reason instanceof Error
                ? companies.reason.message
                : "Failed",
          },
    companyDetails,
    webhook: {
      sampleSecret: demoSecret,
      signature,
      verified: helperSignatureValid,
    },
    protocolEvent: {
      idempotencyKey,
      billingType: mapProtocolEventToBillingType("subscription.renewed"),
      event: protocolEvent,
    },
  };
}

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      status: getNodeStatus(),
      snapshot: await buildLiveSnapshot(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: getNodeStatus(),
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Node showcase",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { action?: string } = {};
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    body = {};
  }

  const client = getRawArcenClient();
  const company = getDemoCompanyKeys();
  const user = getDemoUserIdentity();

  try {
    switch (body.action) {
      case "identify": {
        const result = await client.identify({
          company: getDemoCompanyIdentity(),
          user,
          expiresIn: 3600,
        });
        return NextResponse.json({ ok: true, action: body.action, result });
      }

      case "createAccessToken": {
        const result = await client.createAccessToken(company, user, 1800);
        return NextResponse.json({ ok: true, action: body.action, result });
      }

      case "track": {
        await client.track({
          name: "sdk_showcase_backend_track",
          company,
          traits: {
            surface: "node-sdk-demo",
            timestamp: new Date().toISOString(),
          },
        });
        return NextResponse.json({
          ok: true,
          action: body.action,
          result: { tracked: true, event: "sdk_showcase_backend_track" },
        });
      }

      case "consume": {
        const result = await client.consumeEntitlement({
          featureKey: "scan",
          company,
          idempotencyKey: `node-showcase-${Date.now()}`,
        });
        return NextResponse.json({ ok: true, action: body.action, result });
      }

      case "checkFlags": {
        const result = await client.checkFlags([...FEATURE_KEYS], company);
        return NextResponse.json({ ok: true, action: body.action, result });
      }

      case "listCompanies": {
        const result = await client.listCompanies({ limit: 5 });
        return NextResponse.json({
          ok: true,
          action: body.action,
          result: {
            count: result.count,
            sample: result.data.slice(0, 5).map((item) => ({
              id: item.id,
              name: item.name,
              activePlanId: item.activePlanId ?? null,
            })),
          },
        });
      }

      default:
        return NextResponse.json(
          { ok: false, error: "Unknown action" },
          { status: 400 },
        );
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        action: body.action ?? null,
        error:
          error instanceof Error
            ? error.message
            : "Node showcase action failed",
      },
      { status: 500 },
    );
  }
}
