import type { Context } from "hono";
import { createHash, randomBytes, createHmac } from "crypto";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { db } from "../../../db.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;

function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

export async function createPreviewToken(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const teamId = auth.team.teamId;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  let body: { companyId?: string; componentId?: string };
  try { body = await c.req.json(); } catch { body = {}; }

  const componentId = body.componentId?.trim();
  if (!componentId) {
    return c.json({ error: "componentId is required" }, 400 as any);
  }

  const component = await db.embedComponent.findFirst({
    where: { id: componentId, teamId, environmentId: activeEnvironment.id },
    select: { id: true },
  });
  if (!component) {
    return c.json({ error: "Component not found" }, 404 as any);
  }

  const expiresIn = 600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const secret = ACCESS_TOKEN_SECRET;
  if (!secret) return c.json({ error: "Server configuration error" }, 500 as any);

  const payload = {
    teamId,
    environmentId: activeEnvironment.id,
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
      environmentId: activeEnvironment.id,
      tokenHash,
      companyId: body.companyId ?? null,
      userId: null,
      expiresAt,
    },
  });

  return c.json({ token, expiresAt: expiresAt.toISOString() });
}
