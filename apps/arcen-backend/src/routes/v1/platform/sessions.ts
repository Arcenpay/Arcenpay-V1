import type { Context } from "hono";
import { z } from "zod";
import { FACILITATOR_SECRET, FACILITATOR_URL } from "../../../config.js";
import { getGraphUrl } from "../../../config.js";
import { isErrorResponse, requirePermission } from "../../../lib/auth/api-auth.js";
import { db } from "../../../db.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";
import {
  RUNTIME_CHAIN_ID,
  RUNTIME_CHAIN_PROFILE,
} from "../../../lib/platform/runtime-chain.js";
import { getChainFamily } from "@arcenpay/internal-core";

const querySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
  sessionLimit: z.coerce.number().int().min(1).max(200).optional(),
  proofLimit: z.coerce.number().int().min(1).max(200).optional(),
});

type SessionRow = {
  id: string;
  agent: string;
  totalFunded: string;
  totalWithdrawn: string;
  totalSettled: string;
  currentBalance: string;
  settlements: Array<{
    id: string;
    callCount: string;
    settlementAmount: string;
    timestamp: string;
    txHash: string;
  }>;
};

type ProofRow = {
  id: string;
  sessionId: string;
  agentAddress: string;
  callCount: string;
  settlementAmount: string;
  windowStart: string;
  windowEnd: string;
  txHash: string;
  timestamp: string;
};

type ActiveProofJob = {
  sessionId: string;
  status: "pending" | "generating" | "submitting" | "done" | "failed";
  attempts: number;
  callCount: number;
  windowStart: number;
  windowEnd: number;
  nullifier?: string;
  error?: string;
  createdAt: string;
  lastAttemptAt?: string;
};

const SESSIONS_AND_PROOFS_QUERY = `
  query DashboardSessionsAndProofs($sessionLimit: Int!, $proofLimit: Int!) {
    sessions(orderBy: totalFunded, orderDirection: desc, first: $sessionLimit) {
      id
      agent
      totalFunded
      totalWithdrawn
      totalSettled
      currentBalance
      settlements(orderBy: timestamp, orderDirection: desc, first: 5) {
        id
        callCount
        settlementAmount
        timestamp
        txHash
      }
    }
    proofSubmissions(orderBy: timestamp, orderDirection: desc, first: $proofLimit) {
      id
      sessionId
      agentAddress
      callCount
      settlementAmount
      windowStart
      windowEnd
      txHash
      timestamp
    }
  }
`;

async function readSessionsAndProofsFromSubgraph(
  chainId: number,
  sessionLimit: number,
  proofLimit: number,
): Promise<{
  sessions: SessionRow[];
  proofs: ProofRow[];
  status: "ok" | "unavailable" | "not_configured";
}> {
  // Stellar has no TheGraph subgraph — sessions live on-chain (Soroban)
  // and are read by the facilitator. Short-circuit instead of returning
  // a misleading "unavailable".
  if (getChainFamily(chainId) === "stellar") {
    return { sessions: [], proofs: [], status: "not_configured" };
  }

  const graphUrl = getGraphUrl(chainId);
  if (!graphUrl) {
    return { sessions: [], proofs: [], status: "not_configured" };
  }

  try {
    const res = await fetch(graphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: SESSIONS_AND_PROOFS_QUERY,
        variables: { sessionLimit, proofLimit },
      }),
    });

    if (!res.ok) {
      return { sessions: [], proofs: [], status: "unavailable" };
    }

    const json = (await res.json()) as {
      data?: {
        sessions?: SessionRow[];
        proofSubmissions?: ProofRow[];
      };
    };

    return {
      sessions: Array.isArray(json.data?.sessions) ? json.data.sessions : [],
      proofs: Array.isArray(json.data?.proofSubmissions)
        ? json.data.proofSubmissions
        : [],
      status: "ok",
    };
  } catch {
    return { sessions: [], proofs: [], status: "unavailable" };
  }
}

async function readActiveProofJobs(_chainId: number): Promise<{
  count: number;
  jobs: ActiveProofJob[];
  status: "ok" | "unavailable";
  chainMismatch?: { requestedChainId: number; facilitatorChainId: number };
  message?: string;
}> {
  try {
    const healthRes = await fetch(`${FACILITATOR_URL}/health`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(FACILITATOR_SECRET
          ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
          : {}),
      },
    });

    let chainMismatch:
      | { requestedChainId: number; facilitatorChainId: number }
      | undefined;

    if (healthRes.ok) {
      const health = (await healthRes.json()) as { chainId?: number };
      if (
        typeof health.chainId === "number" &&
        health.chainId !== _chainId
      ) {
        chainMismatch = {
          requestedChainId: _chainId,
          facilitatorChainId: health.chainId,
        };
      }
    }

    const upstream = await fetch(`${FACILITATOR_URL}/api/proofs/active`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(FACILITATOR_SECRET
          ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
          : {}),
      },
    });

    if (!upstream.ok) {
      return {
        count: 0,
        jobs: [],
        status: "unavailable",
        chainMismatch,
      };
    }

    const payload = (await upstream.json()) as {
      count?: number;
      jobs?: ActiveProofJob[];
    };
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    return {
      count: Number(payload.count) || jobs.length,
      jobs,
      status: "ok",
      chainMismatch,
    };
  } catch {
    return { count: 0, jobs: [], status: "unavailable" };
  }
}

export async function getSessions(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }
  const environmentMode = activeEnvironment.mode;
  const chainId = activeEnvironment.chainId;
  const sessionLimit = parsed.data.sessionLimit || 50;
  const proofLimit = parsed.data.proofLimit || 20;

  const [subgraphData, activeProofs] = await Promise.all([
    readSessionsAndProofsFromSubgraph(chainId, sessionLimit, proofLimit),
    readActiveProofJobs(chainId),
  ]);

  return c.json({
    context: {
      teamId: auth.team.teamId,
      environmentMode,
      chainId,
    },
    degraded:
      subgraphData.status === "unavailable" || activeProofs.status !== "ok",
    dependencyHealth: {
      subgraph: subgraphData.status,
      facilitator: activeProofs.status,
    },
    sessions: subgraphData.sessions,
    proofs: subgraphData.proofs,
    activeProofs,
    runtimeChain: {
      expectedChainId: RUNTIME_CHAIN_ID,
      expectedChainName: RUNTIME_CHAIN_PROFILE.chainName,
      rpcEnvKeys: RUNTIME_CHAIN_PROFILE.rpcEnvKeys,
      subgraphEnvKeys: RUNTIME_CHAIN_PROFILE.subgraphEnvKeys,
    },
  });
}
