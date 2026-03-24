import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

// Bundles are stored as JSON in CatalogCreditType.metadata under the key "bundles"
// Shape: { id: string, name: string, units: number, price: number }[]

const bundleSchema = z.object({
  id: z.string().cuid().optional(),
  name: z.string().min(1),
  units: z.coerce.number().int().positive(),
  price: z.coerce.number().positive(),
});

function getBundles(metadata: unknown): z.infer<typeof bundleSchema>[] {
  if (!metadata || typeof metadata !== "object") return [];
  const meta = metadata as Record<string, unknown>;
  if (!Array.isArray(meta.bundles)) return [];
  return meta.bundles as z.infer<typeof bundleSchema>[];
}

// GET /api/catalog/credits/[id]/bundles
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return NextResponse.json({ error: "Credit type not found" }, { status: 404 });
  }

  const bundles = getBundles(creditType.metadata);
  return NextResponse.json({ bundles });
}

// POST /api/catalog/credits/[id]/bundles — add or update a bundle
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return NextResponse.json({ error: "Credit type not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bundleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const existing = getBundles(creditType.metadata);
  const bundleId = parsed.data.id || Math.random().toString(36).substring(2, 11);
  const newBundle = { ...parsed.data, id: bundleId };

  let newBundles;
  if (parsed.data.id) {
    // Update existing
    newBundles = existing.map((b) => (b.id === parsed.data.id ? newBundle : b));
  } else {
    // Add new
    newBundles = [...existing, newBundle];
  }

  const updatedMeta = {
    ...((creditType.metadata as Record<string, unknown>) ?? {}),
    bundles: newBundles,
  };

  const updated = await db.catalogCreditType.update({
    where: { id: creditType.id },
    data: { metadata: updatedMeta },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.bundle.save",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: newBundle,
  });

  return NextResponse.json({ bundles: newBundles, creditType: updated });
}

// DELETE /api/catalog/credits/[id]/bundles?bundleId=xxx
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("catalog:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await params;
  const bundleId = request.nextUrl.searchParams.get("bundleId");

  if (!bundleId) {
    return NextResponse.json(
      { error: "bundleId is required" },
      { status: 400 },
    );
  }

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return NextResponse.json({ error: "Credit type not found" }, { status: 404 });
  }

  const existing = getBundles(creditType.metadata);
  const filtered = existing.filter((b) => b.id !== bundleId);

  if (filtered.length === existing.length) {
    return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
  }

  const updatedMeta = {
    ...((creditType.metadata as Record<string, unknown>) ?? {}),
    bundles: filtered,
  };

  await db.catalogCreditType.update({
    where: { id: creditType.id },
    data: { metadata: updatedMeta },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.bundle.remove",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: { bundleId },
  });

  return NextResponse.json({ bundles: filtered });
}
