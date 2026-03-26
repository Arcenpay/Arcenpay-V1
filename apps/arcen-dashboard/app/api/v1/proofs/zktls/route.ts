/**
 * POST /api/v1/proofs/zktls
 *
 * Submit a Reclaim Protocol zkTLS proof to gate Web3 features
 * based on verified Web2 data (subscription status, API usage, etc).
 *
 * Authorization: Bearer api_xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, isApiKeyError } from "@/lib/api-key-auth";
import { db } from "@/lib/db";
import { verifyReclaimProof } from "@/lib/zktls";
import { resolveCompany, resolveUser, type CompanyKeys, type UserKeys } from "@/lib/flag-engine";
import { invalidateFlagCache } from "@/lib/flag-cache";
import { Prisma } from "@/src/generated/prisma/client";

export async function POST(req: NextRequest) {
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

  const { teamId } = ctx;

  let body: {
    proof: unknown;
    companyKeys?: CompanyKeys;
    userKeys?: UserKeys;
    expiresIn?: number; // seconds until proof expires (optional)
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.proof) {
    return NextResponse.json({ error: "proof is required" }, { status: 400 });
  }

  // ── expiresIn / expiresAt validation ────────────────────────
  if (body.expiresIn !== undefined) {
    if (typeof body.expiresIn !== "number" || !Number.isFinite(body.expiresIn)) {
      return NextResponse.json({ error: "expiresIn must be a number" }, { status: 400 });
    }
    // expiresIn of 0 means no expiry; otherwise must be in the future (> 0 seconds)
    if (body.expiresIn !== 0 && body.expiresIn <= 0) {
      return NextResponse.json({ error: "expiresIn must be 0 (no expiry) or a positive number of seconds" }, { status: 400 });
    }
  }

  // Verify the Reclaim proof
  const verification = await verifyReclaimProof(body.proof);

  if (!verification.valid) {
    return NextResponse.json(
      { error: "Invalid proof", detail: verification.error },
      { status: 422 },
    );
  }

  // Check for replay attack (same proof submitted twice)
  const existing = await db.zkTlsProof.findUnique({
    where: { proofHash: verification.proofHash },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Proof already used (replay detected)", proofId: existing.id },
      { status: 409 },
    );
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

  // Update company traits with verified claims (so flag rules can also use company_trait conditions)
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

    // Invalidate flag cache so the new proof is reflected immediately
    invalidateFlagCache(`${teamId}:`);
  }

  return NextResponse.json({
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
export async function GET(req: NextRequest) {
  const ctx = await requireApiKey(req);
  if (isApiKeyError(ctx)) return ctx;

  const { teamId } = ctx;
  const companyId = req.nextUrl.searchParams.get("companyId");
  const providerId = req.nextUrl.searchParams.get("providerId");

  const url = req.nextUrl;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

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

  return NextResponse.json({ data: proofs });
}
