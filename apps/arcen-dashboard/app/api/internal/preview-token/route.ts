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
import { createHash, randomBytes, createHmac } from "crypto";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { db } from "@/lib/db";

function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const teamId = auth.team.teamId;

  let body: { companyId?: string; componentId?: string };
  try { body = await req.json(); } catch { body = {}; }

  const componentId = body.componentId?.trim();
  if (!componentId) {
    return NextResponse.json(
      { error: "componentId is required" },
      { status: 400 },
    );
  }

  const component = await db.embedComponent.findFirst({
    where: { id: componentId, teamId },
    select: { id: true },
  });
  if (!component) {
    return NextResponse.json(
      { error: "Component not found" },
      { status: 404 },
    );
  }

  const expiresIn = 600; // 10 minutes for preview
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });

  const payload = {
    teamId,
    companyId: body.companyId ?? null,
    userId: null,
    componentId,
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
