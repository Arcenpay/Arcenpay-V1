// ============================================================
//  Dashboard API — Link Wallet to Clerk Account
//  POST /api/auth/link-wallet
//
//  Called after Clerk sign-in to link a wallet address to the
//  authenticated user's DB record via SIWE proof.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { verifyMessage } from "viem";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildSIWEMessage, slugify, type TeamRole } from "@/lib/auth";
import { consumeNonce } from "@/lib/nonce.server";

const Schema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.number().int().positive(),
  nonce: z.string().min(1),
});

async function ensureTeam(
  userId: string,
  walletAddress: string,
  clerkUserId: string,
): Promise<{ teamId: string; teamRole: TeamRole }> {
  const existing = await db.teamMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return { teamId: existing.teamId, teamRole: existing.role as TeamRole };
  }

  let slug = slugify(`workspace-${walletAddress.slice(2, 8).toLowerCase()}`);
  if (await db.team.findUnique({ where: { slug } })) {
    slug = `${slug}-${Date.now()}`;
  }

  // Create Clerk org for this personal workspace
  const client = await clerkClient();
  let clerkOrgId: string | undefined;
  try {
    const org = await client.organizations.createOrganization({
      name: "My Workspace",
      createdBy: clerkUserId,
    });
    clerkOrgId = org.id;
  } catch (err) {
    // Non-fatal: team still works without Clerk org linkage
    console.warn("[link-wallet] Could not create Clerk org:", err);
  }

  const team = await db.team.create({
    data: {
      name: "My Workspace",
      slug,
      clerkOrgId: clerkOrgId ?? null,
      members: { create: { userId, role: "OWNER" } },
    },
  });

  await db.user.update({
    where: { id: userId },
    data: { currentTeamId: team.id },
  });

  return { teamId: team.id, teamRole: "OWNER" };
}

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { message, signature, address, chainId, nonce } = parsed.data;

    // Validate nonce (DB-backed, one-time use)
    const nonceRecord = await consumeNonce(nonce);
    if (!nonceRecord) {
      return NextResponse.json(
        { error: "Invalid or expired nonce" },
        { status: 401 },
      );
    }

    // Rebuild and verify SIWE message
    const host = req.headers.get("host") || "arcenpay.xyz";
    const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
    const proto =
      req.headers.get("x-forwarded-proto") || (isLocal ? "http" : "https");
    const expectedMessage = buildSIWEMessage({
      address,
      chainId,
      nonce,
      domain: host,
      uri: `${proto}://${host}`,
      issuedAt: nonceRecord.issuedAt,
    });

    if (message !== expectedMessage) {
      return NextResponse.json(
        { error: "SIWE message mismatch" },
        { status: 401 },
      );
    }

    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message: expectedMessage,
      signature: signature as `0x${string}`,
    });
    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Check if wallet is already claimed by a different Clerk user
    const walletOwner = await db.user.findUnique({
      where: { walletAddress: address },
    });
    if (
      walletOwner &&
      walletOwner.clerkUserId &&
      walletOwner.clerkUserId !== clerkUserId
    ) {
      return NextResponse.json(
        { error: "This wallet is already linked to another account" },
        { status: 409 },
      );
    }

    // Fetch Clerk user to get email
    const clerkUser = await currentUser();
    const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? undefined;

    let dbUser: { id: string };

    if (walletOwner && !walletOwner.clerkUserId) {
      // Existing wallet-first user — attach Clerk ID
      dbUser = await db.user.update({
        where: { id: walletOwner.id },
        data: { clerkUserId, ...(email ? { email, emailVerified: true } : {}) },
      });
    } else {
      // New or Clerk-first user — upsert by clerkUserId
      dbUser = await db.user.upsert({
        where: { clerkUserId },
        create: {
          clerkUserId,
          walletAddress: address,
          ...(email ? { email, emailVerified: true } : {}),
        },
        update: { walletAddress: address },
      });
    }

    // Ensure personal workspace team exists
    await ensureTeam(dbUser.id, address, clerkUserId);

    // Mark wallet as linked in Clerk metadata
    try {
      const client = await clerkClient();
      await client.users.updateUserMetadata(clerkUserId, {
        publicMetadata: { walletLinked: true, walletAddress: address },
      });
    } catch (err) {
      console.warn("[link-wallet] Could not update Clerk metadata:", err);
    }

    return NextResponse.json({ ok: true, address });
  } catch (err) {
    console.error("[api/auth/link-wallet]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
