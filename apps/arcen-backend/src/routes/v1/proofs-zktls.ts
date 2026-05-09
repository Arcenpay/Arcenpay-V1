/**
 * POST /api/v1/proofs/zktls
 *
 * Submit a Reclaim Protocol zkTLS proof to gate Web3 features
 * based on verified Web2 data (subscription status, API usage, etc).
 *
 * Authorization: Bearer api_xxx
 */

import type { Context } from "hono";
import { requireApiKey, isApiKeyError } from "../../lib/auth/api-key-auth.js";
import { db } from "../../db.js";

import { resolveCompany, resolveUser, type CompanyKeys, type UserKeys } from "../../lib/entitlements/flag-engine.js";
import { invalidateFlagCache } from "../../lib/entitlements/flag-cache.js";
import { Prisma } from "../../generated/client/client.js";

async function verifyReclaimProof(_proof: unknown): Promise<{ valid: boolean; error?: string; proofHash: string; providerId: string; providerName: string; claims: Record<string, unknown> }> {
  throw new Error("verifyReclaimProof not implemented");
}

export async function POST(c: Context) {
  const ctx = await requireApiKey(c.req.raw);
  if (isApiKeyError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { teamId } = ctx;

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
    return c.json({ error: "Invalid proof", detail: verification.error }, 422 as any);
  }

  // Check for replay attack (same proof submitted twice)
  const existing = await db.zkTlsProof.findUnique({
    where: { proofHash: verification.proofHash },
  });
  if (existing) {
    return c.json({ error: "Proof already used (replay detected)", proofId: existing.id }, 409 as any);
  }

  // Resolve company and user
  const company = body.companyKeys ? await resolveCompany(teamId, body.companyKeys) : null;
  const user = body.userKeys && company ? await resolveUser(teamId, body.userKeys) : null;

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
