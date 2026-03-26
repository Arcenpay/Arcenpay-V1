/**
 * GET  /api/v1/api-keys   — List API keys for the authenticated team (dashboard session)
 * POST /api/v1/api-keys   — Create a new API key (raw key shown once)
 *
 * Note: This endpoint uses DASHBOARD session auth (Clerk), not API key auth.
 * Only authenticated team members can manage API keys.
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { generateApiKey } from "@/lib/api-key-auth";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const ctx = await requirePermission("catalog:read");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;

  const keys = await db.arcenApiKey.findMany({
    where: { teamId: team.teamId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      description: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ data: keys });
}

export async function POST(req: NextRequest) {
  const ctx = await requirePermission("catalog:write");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;

  let body: { name: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { raw, hash, prefix } = generateApiKey();

  const apiKey = await db.arcenApiKey.create({
    data: {
      teamId: team.teamId,
      name: body.name.trim(),
      keyHash: hash,
      prefix,
      description: body.description,
    },
  });

  return NextResponse.json(
    {
      data: {
        id: apiKey.id,
        name: apiKey.name,
        prefix,
        // Raw key only returned on creation — never again
        key: raw,
        createdAt: apiKey.createdAt,
      },
      warning: "Store this API key securely. It will not be shown again.",
    },
    { status: 201 },
  );
}

export async function DELETE(req: NextRequest) {
  const ctx = await requirePermission("catalog:write");
  if (isErrorResponse(ctx)) return ctx;

  const { team } = ctx;
  const keyId = req.nextUrl.searchParams.get("id");

  if (!keyId) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }

  const key = await db.arcenApiKey.findFirst({
    where: { id: keyId, teamId: team.teamId },
  });

  if (!key) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  await db.arcenApiKey.delete({ where: { id: keyId } });

  return NextResponse.json({ ok: true });
}
