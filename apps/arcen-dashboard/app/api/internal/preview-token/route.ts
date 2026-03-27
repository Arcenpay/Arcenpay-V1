/**
 * POST /api/internal/preview-token
 *
 * Dashboard-internal endpoint to generate a short-lived embed token
 * for component preview. Uses Clerk session auth (no API key needed).
 *
 * Body: { companyId?: string; componentId: string }
 * Returns: { token: string; expiresAt: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { createHash, randomBytes, createHmac } from "crypto";
import { db } from "@/lib/db";

function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamCtx = await resolveTeamContext(session);
  if (!teamCtx) return NextResponse.json({ error: "No team found" }, { status: 404 });

  const { teamId } = teamCtx;

  let body: { companyId?: string; componentId?: string };
  try { body = await req.json(); } catch { body = {}; }

  const expiresIn = 600; // 10 minutes for preview
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });

  const payload = {
    teamId,
    companyId: body.companyId ?? null,
    userId: null,
    exp: Math.floor(expiresAt.getTime() / 1000),
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(16).toString("hex"),
    preview: true,
  };

  const token = signToken(payload, secret);
  const tokenHash = createHash("sha256").update(token).digest("hex");

  await db.embedAccessToken.create({
    data: {
      teamId,
      tokenHash,
      companyId: body.companyId ?? null,
      userId: null,
      expiresAt,
    },
  });

  return NextResponse.json({ token, expiresAt: expiresAt.toISOString() });
}
