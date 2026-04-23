import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FACILITATOR_SECRET, FACILITATOR_URL, getGraphUrl } from "@/lib/config";
import { isErrorResponse, requirePermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { resolveEnvironmentChainId } from "@/lib/default-chain";

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
): Promise<{ sessions: SessionRow[]; proofs: ProofRow[] }> {
  const graphUrl = getGraphUrl(chainId);
  if (!graphUrl) {
    return { sessions: [], proofs: [] };
  }

  try {
    const res = await fetch(graphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: SESSIONS_AND_PROOFS_QUERY,
        variables: { sessionLimit, proofLimit },
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      return { sessions: [], proofs: [] };
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
    };
  } catch {
    return { sessions: [], proofs: [] };
  }
}

async function readActiveProofJobs(chainId: number): Promise<{
  count: number;
  jobs: ActiveProofJob[];
  chainMismatch?: { requestedChainId: number; facilitatorChainId: number };
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
      cache: "no-store",
    });

    if (healthRes.ok) {
      const health = (await healthRes.json()) as { chainId?: number };
      if (typeof health.chainId === "number" && health.chainId !== chainId) {
        return {
          count: 0,
          jobs: [],
          chainMismatch: {
            requestedChainId: chainId,
            facilitatorChainId: health.chainId,
          },
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
      cache: "no-store",
    });

    if (!upstream.ok) {
      return { count: 0, jobs: [] };
    }

    const payload = (await upstream.json()) as {
      count?: number;
      jobs?: ActiveProofJob[];
    };
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    return { count: Number(payload.count) || jobs.length, jobs };
  } catch {
    return { count: 0, jobs: [] };
  }
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const team = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { environmentMode: true },
  });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const environmentMode = parsed.data.environmentMode || team.environmentMode;
  const chainId = resolveEnvironmentChainId(
    environmentMode,
    parsed.data.chainId,
  );
  const sessionLimit = parsed.data.sessionLimit || 50;
  const proofLimit = parsed.data.proofLimit || 20;

  const [subgraphData, activeProofs] = await Promise.all([
    readSessionsAndProofsFromSubgraph(chainId, sessionLimit, proofLimit),
    readActiveProofJobs(chainId),
  ]);

  return NextResponse.json({
    context: {
      teamId: auth.team.teamId,
      environmentMode,
      chainId,
    },
    sessions: subgraphData.sessions,
    proofs: subgraphData.proofs,
    activeProofs,
  });
}
