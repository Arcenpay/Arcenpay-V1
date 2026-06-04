/**
 * POST /api/v1/proofs/zktls
 *
 * Submit a Reclaim Protocol zkTLS proof to gate Web3 features
 * based on verified Web2 data (subscription status, API usage, etc).
 *
 * Authorization: Bearer api_xxx
 */

import type { Context } from "hono";
import { createHash } from "node:crypto";
import { requireApiKey, isApiKeyError } from "../../lib/auth/api-key-auth.js";
import { db } from "../../db.js";

import { resolveCompany, resolveUser, type CompanyKeys, type UserKeys } from "../../lib/entitlements/flag-engine.js";
import { invalidateFlagCache } from "../../lib/entitlements/flag-cache.js";
import { Prisma } from "../../generated/client/client.js";

type ReclaimVerification = {
  valid: boolean;
  error?: string;
  status?: 422 | 503;
  proofHash: string;
  providerId: string;
  providerName: string;
  claims: Record<string, unknown>;
};

type ReclaimSdk = {
  verifyProof?: (proof: unknown) => boolean | Promise<boolean>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function proofHashFor(proof: unknown): string {
  return createHash("sha256").update(stableStringify(proof)).digest("hex");
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractClaims(proof: Record<string, unknown>, claimData: Record<string, unknown>): Record<string, unknown> {
  const directClaims = parseJsonRecord(proof.claims);
  if (directClaims) return directClaims;

  const extractedValues = parseJsonRecord(claimData.extractedParameterValues);
  if (extractedValues) return extractedValues;

  const context = parseJsonRecord(claimData.context);
  if (context) return context;

  const parameters = parseJsonRecord(claimData.parameters);
  if (parameters) return parameters;

  return Object.fromEntries(
    Object.entries(claimData).filter(([key]) =>
      ["context", "parameters", "provider", "providerId", "providerName"].includes(key) === false,
    ),
  );
}

async function loadReclaimVerifier(): Promise<ReclaimSdk | null> {
  try {
    const packageName = "@reclaimprotocol/js-sdk";
    return (await import(packageName)) as ReclaimSdk;
  } catch {
    return null;
  }
}

async function verifyReclaimProof(proof: unknown): Promise<ReclaimVerification> {
  const proofHash = proofHashFor(proof);
  const proofRecord = isRecord(proof) ? proof : {};
  const claimData = parseJsonRecord(proofRecord.claimData) ?? proofRecord;
  const providerId = firstString(
    proofRecord.providerId,
    proofRecord.provider,
    claimData.providerId,
    claimData.provider,
  );
  const providerName =
    firstString(proofRecord.providerName, claimData.providerName, claimData.provider) ??
    providerId ??
    "Reclaim Protocol";
  const claims = extractClaims(proofRecord, claimData);

  if (!providerId) {
    return {
      valid: false,
      status: 422,
      error: "Reclaim proof is missing providerId/provider metadata.",
      proofHash,
      providerId: "",
      providerName,
      claims,
    };
  }

  const reclaim = await loadReclaimVerifier();
  if (!reclaim?.verifyProof) {
    return {
      valid: false,
      status: 503,
      error:
        "Reclaim proof verification is not configured. Install @reclaimprotocol/js-sdk in the backend to enable zkTLS proof submission.",
      proofHash,
      providerId,
      providerName,
      claims,
    };
  }

  try {
    const valid = await reclaim.verifyProof(proof);
    return {
      valid,
      status: valid ? undefined : 422,
      error: valid ? undefined : "Reclaim proof verification failed.",
      proofHash,
      providerId,
      providerName,
      claims,
    };
  } catch (error) {
    return {
      valid: false,
      status: 422,
      error: error instanceof Error ? error.message : "Reclaim proof verification failed.",
      proofHash,
      providerId,
      providerName,
      claims,
    };
  }
}

export async function POST(c: Context) {
  const ctx = await requireApiKey(c.req.raw);
  if (isApiKeyError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { teamId } = ctx;
  const environmentId = ctx.environmentId ?? null;

  let body: {
    proof: unknown;
    companyKeys?: CompanyKeys;
    userKeys?: UserKeys;
    expiresIn?: number; // seconds until proof expires (optional)
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  if (!body.proof) {
    return c.json({ error: "proof is required" }, 400 as any);
  }

  // ── expiresIn / expiresAt validation ────────────────────────
  if (body.expiresIn !== undefined) {
    if (typeof body.expiresIn !== "number" || !Number.isFinite(body.expiresIn)) {
      return c.json({ error: "expiresIn must be a number" }, 400 as any);
    }
    if (body.expiresIn !== 0 && body.expiresIn <= 0) {
      return c.json({ error: "expiresIn must be 0 (no expiry) or a positive number of seconds" }, 400 as any);
    }
  }

  // Verify the Reclaim proof
  const verification = await verifyReclaimProof(body.proof);

  if (!verification.valid) {
    return c.json(
      { error: "Invalid proof", detail: verification.error },
      (verification.status ?? 422) as any,
    );
  }

  // Check for replay attack (same proof submitted twice)
  const existing = await db.zkTlsProof.findUnique({
    where: { proofHash: verification.proofHash },
  });
  if (existing) {
    return c.json({ error: "Proof already used (replay detected)", proofId: existing.id }, 409 as any);
  }

  // Resolve company and user
  const company = body.companyKeys
    ? await resolveCompany(teamId, {
        ...body.companyKeys,
        environmentId,
      })
    : null;
  const user =
    body.userKeys && company
      ? await resolveUser(teamId, {
          ...body.userKeys,
          environmentId,
        })
      : null;

  const expiresAt = body.expiresIn
    ? new Date(Date.now() + body.expiresIn * 1000)
    : null;

  // Store the verified proof
  const proof = await db.zkTlsProof.create({
    data: {
      teamId,
      companyId: company?.id ?? null,
      userId: user?.id ?? null,
      providerId: verification.providerId,
      providerName: verification.providerName,
      claimData: verification.claims as unknown as Prisma.InputJsonValue,
      proofHash: verification.proofHash,
      expiresAt,
    },
  });

  // Update company traits with verified claims
  if (company) {
    const existingCompany = await db.arcenCompany.findUnique({
      where: { id: company.id },
      select: { traits: true },
    });
    if (existingCompany) {
      const mergedTraits = {
        ...(existingCompany.traits as Record<string, unknown>),
        [`zktls_${verification.providerId}`]: true,
        ...Object.fromEntries(
          Object.entries(verification.claims).map(([k, v]) => [
            `zktls_claim_${k}`,
            v,
          ]),
        ),
      };
      await db.arcenCompany.update({
        where: { id: company.id },
        data: { traits: mergedTraits as unknown as Prisma.InputJsonValue },
      });
    }

    invalidateFlagCache(`${teamId}:`);
  }

  return c.json({
    data: {
      id: proof.id,
      providerId: proof.providerId,
      providerName: proof.providerName,
      claims: proof.claimData,
      verifiedAt: proof.verifiedAt,
      expiresAt: proof.expiresAt,
      companyId: company?.id ?? null,
      userId: user?.id ?? null,
    },
  });
}

/**
 * GET /api/v1/proofs/zktls
 * List verified zkTLS proofs for the team.
 */
export async function GET(c: Context) {
  const ctx = await requireApiKey(c.req.raw);
  if (isApiKeyError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { teamId } = ctx;
  const companyId = c.req.query("companyId");
  const providerId = c.req.query("providerId");

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const proofs = await db.zkTlsProof.findMany({
    where: {
      teamId,
      ...(companyId ? { companyId } : {}),
      ...(providerId ? { providerId } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { verifiedAt: "desc" },
    take: limit,
    select: {
      id: true,
      providerId: true,
      providerName: true,
      claimData: true,
      verifiedAt: true,
      expiresAt: true,
      companyId: true,
      userId: true,
    },
  });

  return c.json({ data: proofs });
}
