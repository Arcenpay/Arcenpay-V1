import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { z } from "zod";
import {
  buildSIWEMessage,
  createSession,
  COOKIE_NAME,
  slugify,
  type TeamRole,
} from "@/lib/auth";
import { consumeNonce } from "@/lib/nonce.server";
import { db } from "@/lib/db";

// ── Zod schema for /auth/verify request body ──────────────────
const VerifySchema = z.object({
  message: z.string().min(1, "message is required"),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, "signature must be a hex string"),
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "address must be a valid Ethereum address"),
  chainId: z.number().int().positive("chainId must be a positive integer"),
  nonce: z.string().min(1, "nonce is required"),
});

// ── Ensure user has a team, auto-creating a personal workspace if needed ───────
async function ensureTeam(
  userId: string,
  walletAddress: string,
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

  const team = await db.team.create({
    data: {
      name: "My Workspace",
      slug,
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
    const body = await req.json();

    const parsed = VerifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { message, signature, address, chainId, nonce } = parsed.data;

    const nonceRecord = await consumeNonce(nonce);
    if (!nonceRecord) {
      console.error("[auth/verify] nonce not found or expired:", nonce);
      return NextResponse.json(
        { error: "Invalid or expired nonce" },
        { status: 401 },
      );
    }

    // Reconstruct domain + uri robustly for both localhost and production
    const host = req.headers.get("host") || "arcenpay.xyz";
    const isLocal =
      host.includes("localhost") || host.includes("127.0.0.1");
    const proto =
      req.headers.get("x-forwarded-proto") || (isLocal ? "http" : "https");
    const domain = host;
    const uri = `${proto}://${host}`;

    const expectedMessage = buildSIWEMessage({
      address,
      chainId,
      nonce,
      domain,
      uri,
      issuedAt: nonceRecord.issuedAt,
    });

    if (message !== expectedMessage) {
      console.error("[auth/verify] message mismatch\n  got     :", message, "\n  expected:", expectedMessage);
      return NextResponse.json({ error: "SIWE message mismatch" }, { status: 401 });
    }

    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message: expectedMessage,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Upsert user record
    const user = await db.user.upsert({
      where: { walletAddress: address },
      update: {},
      create: { walletAddress: address },
    });

    // Ensure personal team exists
    const { teamId, teamRole } = await ensureTeam(user.id, address);

    const needsEmail = !user.email;

    const token = await createSession(address, chainId, {
      userId: user.id,
      email: user.email ?? undefined,
      teamId,
      teamRole,
      needsEmail,
    });

    const response = NextResponse.json({ ok: true, address, needsEmail, teamId });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error("[auth/verify]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
