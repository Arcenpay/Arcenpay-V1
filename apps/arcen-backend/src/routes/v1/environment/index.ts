import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { createPublicClient, http, type Address } from "viem";
import { getContractAddresses } from "@arcenpay/internal-core";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { FACILITATOR_URL, getRpcUrl } from "../../../config.js";
import { GRAPH_URL } from "../../../config.js";
import { normalizeEnvironmentMode, resolveEnvironmentChainId } from "../../../lib/platform/default-chain.js";
import { SUBGRAPH_REQUIRED } from "../../../lib/platform/launch-flags.js";

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
    return { ok: true, checks: [], failedContracts: [] };
  }

  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 8_000 }),
  });

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

async function switchEnvironment(c: Context) {
  const auth = await requirePermission(c, "environment:switch");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = switchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  if (parsed.data.confirmText !== "CONFIRM") {
    return c.json({ error: "confirmText must equal CONFIRM" }, 400 as any);
  }

  const targetChainId =
    resolveEnvironmentChainId(
      normalizeEnvironmentMode(parsed.data.environmentMode),
      parsed.data.chainId,
    );

  let addresses: ReturnType<typeof getContractAddresses>;
  try {
    addresses = getContractAddresses(targetChainId);
  } catch {
    return c.json({ error: `No configured contracts for chain ${targetChainId}` }, 400 as any);
  }

  if (hasZeroAddress(addresses)) {
    return c.json({
        error:
          "Environment switch blocked: contract registry contains zero-address placeholders.",
      }, 409 as any);
  }

  const missingServices: string[] = [];
  if (SUBGRAPH_REQUIRED && !GRAPH_URL) missingServices.push("GRAPH_URL");
  if (!FACILITATOR_URL) missingServices.push("FACILITATOR_URL");
  if (missingServices.length > 0) {
    return c.json({
        error: "Environment switch blocked: required service endpoints are missing.",
        missingServices,
      }, 409 as any);
  }

  let preflight: PreflightResult;
  try {
    preflight = await runContractPreflight(targetChainId, addresses);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({
        error: "Contract health preflight failed — RPC unreachable.",
        detail: message,
      }, 503 as any);
  }

  if (!preflight.ok) {
    return c.json({
        error: "Contract health preflight failed — contracts not deployed on target chain.",
        failedContracts: preflight.failedContracts,
        checks: preflight.checks,
      }, 409 as any);
  }

  const previous = await db.team.findUnique({
    where: { id: auth.team.teamId },
  });
  if (!previous) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  const team = await db.team.update({
    where: { id: auth.team.teamId },
    data: { environmentMode: normalizeEnvironmentMode(parsed.data.environmentMode) },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
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
      environmentMode: normalizeEnvironmentMode(team.environmentMode),
      chainId: targetChainId,
    },
    metadata: {
      preflightChecks: preflight.checks,
    },
  });

  return c.json({
    ok: true,
    teamId: team.id,
    environmentMode: normalizeEnvironmentMode(team.environmentMode),
    chainId: targetChainId,
    preflight: preflight.checks,
  });
}

export const environmentRoutes = new Hono()
  .post("/switch", switchEnvironment);
