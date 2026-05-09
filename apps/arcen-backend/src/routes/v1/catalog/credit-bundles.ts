import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

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

export async function getCreditBundles(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return c.json({ error: "Credit type not found" }, 404 as any);
  }

  const bundles = getBundles(creditType.metadata);
  return c.json({ bundles });
}

export async function saveCreditBundle(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return c.json({ error: "Credit type not found" }, 404 as any);
  }

  const body = await c.req.json() .catch(() => ({}));
  const parsed = bundleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const existing = getBundles(creditType.metadata);
  const bundleId = parsed.data.id || Math.random().toString(36).substring(2, 11);
  const newBundle = { ...parsed.data, id: bundleId };

  let newBundles;
  if (parsed.data.id) {
    newBundles = existing.map((b) => (b.id === parsed.data.id ? newBundle : b));
  } else {
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
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.bundle.save",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: newBundle,
  });

  return c.json({ bundles: newBundles, creditType: updated });
}

export async function deleteCreditBundle(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const bundleId = c.req.query("bundleId");

  if (!bundleId) {
    return c.json({ error: "bundleId is required" }, 400 as any);
  }

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return c.json({ error: "Credit type not found" }, 404 as any);
  }

  const existing = getBundles(creditType.metadata);
  const filtered = existing.filter((b) => b.id !== bundleId);

  if (filtered.length === existing.length) {
    return c.json({ error: "Bundle not found" }, 404 as any);
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
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.bundle.remove",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: { bundleId },
  });

  return c.json({ bundles: filtered });
}
