// ============================================================
//  Dashboard API — Environment Switch
//  POST /api/environment/switch
//
//  Switches the team's active environment (DEVELOPMENT ↔ PRODUCTION).
//  Runs a live contract health preflight via RPC before committing:
//    1. Registry address lookup (existing check)
//    2. eth_getCode — ensures contracts are actually deployed
//  Both checks run in parallel to minimise latency.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPublicClient, http, type Address } from "viem";
import { getContractAddresses } from "@arcenpay/sdk";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { FACILITATOR_URL, GRAPH_URL, getRpcUrl } from "@/lib/config";

const switchSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]),
  chainId: z.coerce.number().int().positive().optional(),
  confirmText: z.string().optional(),
});

function hasZeroAddress(addresses: object): boolean {
  return Object.values(addresses as Record<string, unknown>).some(
    (value) =>
      typeof value === "string" &&
      value.toLowerCase() === "0x0000000000000000000000000000000000000000",
  );
}

type PreflightResult = {
  ok: boolean;
  checks: { contract: string; address: string; deployed: boolean }[];
  failedContracts: string[];
};

async function runContractPreflight(
  chainId: number,
  addresses: ReturnType<typeof getContractAddresses>,
): Promise<PreflightResult> {
  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    // No RPC configured — skip live check (dev fallback)
    return { ok: true, checks: [], failedContracts: [] };
  }

  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 8_000 }),
  });

  // Check the two most critical contracts: PlanFactory and SubscriptionRegistry
  const contractsToCheck: { name: string; address: string }[] = [
    { name: "planFactory", address: addresses.planFactory },
    { name: "subscriptionRegistry", address: addresses.subscriptionRegistry },
    { name: "feeCollector", address: addresses.feeCollector },
  ];

  const results = await Promise.allSettled(
    contractsToCheck.map(async ({ name, address }) => {
      const code = await client.getBytecode({ address: address as Address });
      return { contract: name, address, deployed: !!code && code !== "0x" };
    }),
  );

  const checks = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      contract: contractsToCheck[i].name,
      address: contractsToCheck[i].address,
      deployed: false,
    };
  });

  const failedContracts = checks
    .filter((c) => !c.deployed)
    .map((c) => c.contract);

  return { ok: failedContracts.length === 0, checks, failedContracts };
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission("environment:switch");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = switchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  if (parsed.data.confirmText !== "CONFIRM") {
    return NextResponse.json(
      { error: "confirmText must equal CONFIRM" },
      { status: 400 },
    );
  }

  const targetChainId =
    parsed.data.chainId ||
    (parsed.data.environmentMode === "PRODUCTION" ? 8453 : 11155111);

  let addresses: ReturnType<typeof getContractAddresses>;
  try {
    addresses = getContractAddresses(targetChainId);
  } catch {
    return NextResponse.json(
      { error: `No configured contracts for chain ${targetChainId}` },
      { status: 400 },
    );
  }

  if (
    parsed.data.environmentMode === "PRODUCTION" &&
    hasZeroAddress(addresses)
  ) {
    return NextResponse.json(
      {
        error:
          "Production switch blocked: contract registry contains zero-address placeholders.",
      },
      { status: 409 },
    );
  }

  if (parsed.data.environmentMode === "PRODUCTION") {
    const missingServices: string[] = [];
    if (!GRAPH_URL) missingServices.push("NEXT_PUBLIC_GRAPH_URL");
    if (!FACILITATOR_URL) missingServices.push("FACILITATOR_URL");
    if (missingServices.length > 0) {
      return NextResponse.json(
        {
          error: "Production switch blocked: required service endpoints are missing.",
          missingServices,
        },
        { status: 409 },
      );
    }
  }

  // ── Contract health preflight ────────────────────────────────────────────────
  let preflight: PreflightResult;
  try {
    preflight = await runContractPreflight(targetChainId, addresses);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Contract health preflight failed — RPC unreachable.",
        detail: message,
      },
      { status: 503 },
    );
  }

  if (!preflight.ok) {
    return NextResponse.json(
      {
        error: "Contract health preflight failed — contracts not deployed on target chain.",
        failedContracts: preflight.failedContracts,
        checks: preflight.checks,
      },
      { status: 409 },
    );
  }

  const previous = await db.team.findUnique({
    where: { id: auth.team.teamId },
  });
  if (!previous) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const team = await db.team.update({
    where: { id: auth.team.teamId },
    data: { environmentMode: parsed.data.environmentMode },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "environment.switch",
    resourceType: "Team",
    resourceId: team.id,
    beforeData: {
      environmentMode: previous.environmentMode,
    },
    afterData: {
      environmentMode: team.environmentMode,
      chainId: targetChainId,
    },
    metadata: {
      preflightChecks: preflight.checks,
    },
  });

  return NextResponse.json({
    ok: true,
    teamId: team.id,
    environmentMode: team.environmentMode,
    chainId: targetChainId,
    preflight: preflight.checks,
  });
}
