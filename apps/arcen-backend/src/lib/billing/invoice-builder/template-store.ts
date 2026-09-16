import { db } from "../../../db.js";
import { toPrismaJson } from "../../../utils/prisma-json.js";
import { asRecord } from "../utils.js";
import { validateInvoiceTemplateConfig } from "./schema.js";
import type { InvoiceTemplateConfig } from "./types.js";

/**
 * Invoice template store — persistence + resolution.
 *
 * Resolution order (strictly enforced so historical documents never drift):
 *   1. `Invoice.templateSnapshot`  — frozen at issuance, always wins.
 *   2. Active `InvoiceTemplate`     — current design for the team/environment.
 *   3. `null`                       — legacy hardcoded renderer (byte parity
 *                                     with pre-builder output, gated FREE tier).
 */

function readTemplateSnapshot(value: unknown): InvoiceTemplateConfig | null {
  const record = asRecord(value);
  const config = record.config ?? value;
  if (!config || typeof config !== "object") return null;
  const result = validateInvoiceTemplateConfig(config);
  return result.ok ? result.config : null;
}

/**
 * Resolves the template config for an invoice context.
 *
 * A corrupt/invalid snapshot never crashes rendering — it falls back to the
 * legacy renderer rather than exploding existing PDF generation paths.
 */
export async function resolveTemplateConfigForTeam(input: {
  teamId: string;
  environmentId: string | null;
  templateId: string | null;
  templateSnapshot: unknown;
}): Promise<InvoiceTemplateConfig | null> {
  const snapshot = readTemplateSnapshot(input.templateSnapshot);
  if (snapshot) return snapshot;

  // No usable snapshot → consult the active template (if any).
  const type = await db.invoiceTemplate.findFirst({
    where: {
      teamId: input.teamId,
      isActive: true,
      ...(input.environmentId
        ? { OR: [{ environmentId: input.environmentId }, { environmentId: null }] }
        : {}),
    },
    orderBy: input.environmentId
      ? [{ environmentId: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }]
      : [{ updatedAt: "desc" }],
    select: { config: true },
  });
  if (!type) return null;

  return readTemplateSnapshot(type.config);
}
// ── CRUD helpers (routes are thin; validation happens before these) ──────────

export async function listInvoiceTemplates(input: {
  teamId: string;
  environmentId: string | null;
}) {
  return db.invoiceTemplate.findMany({
    where: {
      teamId: input.teamId,
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
    },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      environmentId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getInvoiceTemplate(input: {
  teamId: string;
  id: string;
}) {
  return db.invoiceTemplate.findFirst({
    where: { id: input.id, teamId: input.teamId },
  });
}

export async function createInvoiceTemplate(input: {
  teamId: string;
  environmentId: string | null;
  name: string;
  description?: string;
  config: InvoiceTemplateConfig;
}): Promise<{ id: string }> {
  return db.invoiceTemplate.create({
    data: {
      teamId: input.teamId,
      environmentId: input.environmentId ?? undefined,
      name: input.name,
      description: input.description ?? null,
      config: input.config as object,
    },
    select: { id: true },
  });
}

export async function updateInvoiceTemplate(input: {
  teamId: string;
  id: string;
  config: InvoiceTemplateConfig;
  name?: string;
  description?: string;
}): Promise<{ id: string } | null> {
  const existing = await db.invoiceTemplate.findFirst({
    where: { id: input.id, teamId: input.teamId },
    select: { id: true },
  });
  if (!existing) return null;

  await db.invoiceTemplate.update({
    where: { id: input.id },
    data: {
      config: input.config as object,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description ?? null }
        : {}),
    },
  });
  return existing;
}

export async function deleteInvoiceTemplate(input: {
  teamId: string;
  id: string;
}): Promise<boolean> {
  const existing = await db.invoiceTemplate.findFirst({
    where: { id: input.id, teamId: input.teamId },
    select: { id: true },
  });
  if (!existing) return false;
  await db.invoiceTemplate.delete({ where: { id: input.id } });
  return true;
}

/**
 * Activates exactly one template per (team, environment) scope, atomically.
 * Idempotent: activating the already-active template is a no-op.
 */
export async function activateInvoiceTemplate(input: {
  teamId: string;
  id: string;
  environmentId?: string | null;
}): Promise<{ ok: boolean; alreadyActive: boolean } | null> {
  const target = await db.invoiceTemplate.findFirst({
    where: { id: input.id, teamId: input.teamId },
    select: { id: true, environmentId: true },
  });
  if (!target) return null;

  return db.$transaction(async (tx) => {
    const where = {
      teamId: input.teamId,
      isActive: true,
      ...(target.environmentId
        ? { environmentId: target.environmentId }
        : { environmentId: null }),
    };

    const active = await tx.invoiceTemplate.findFirst({
      where,
      select: { id: true },
    });
    if (active?.id === input.id) {
      return { ok: true, alreadyActive: true };
    }

    await tx.invoiceTemplate.updateMany({ where, data: { isActive: false } });
    await tx.invoiceTemplate.update({
      where: { id: input.id },
      data: { isActive: true },
    });
    return { ok: true, alreadyActive: false };
  });
}

export async function duplicateInvoiceTemplate(input: {
  teamId: string;
  environmentId: string | null;
  id: string;
  name: string;
}): Promise<{ id: string } | null> {
  const source = await db.invoiceTemplate.findFirst({
    where: { id: input.id, teamId: input.teamId },
    select: { config: true, description: true },
  });
  if (!source) return null;

  return db.invoiceTemplate.create({
    data: {
      teamId: input.teamId,
      environmentId: input.environmentId ?? undefined,
      name: input.name,
      description: source.description,
      config: toPrismaJson(source.config),
    },
    select: { id: true },
  });
}

