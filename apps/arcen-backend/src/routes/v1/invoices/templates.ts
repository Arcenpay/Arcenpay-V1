import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { Context } from "hono";
import { z } from "zod";
import { INVOICE_STORAGE_DIR } from "../../../config.js";
import {
  isErrorResponse,
  requirePermission,
} from "../../../lib/auth/api-auth.js";
import { assertTierFeature } from "../../../lib/catalog/tier-guard.js";
import { findResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";
import {
  activateInvoiceTemplate,
  createInvoiceTemplate,
  deleteInvoiceTemplate,
  duplicateInvoiceTemplate,
  getInvoiceTemplate,
  listInvoiceTemplates,
  updateInvoiceTemplate,
} from "../../../lib/billing/invoice-builder/template-store.js";
import { validateInvoiceTemplateConfig } from "../../../lib/billing/invoice-builder/schema.js";
import { buildDefaultInvoiceTemplateConfig } from "../../../lib/billing/invoice-builder/default-template.js";
import { renderTemplateInvoicePdf } from "../../../lib/billing/invoice-builder/renderer.js";
import { buildSampleInvoiceContext } from "../../../lib/billing/invoice-builder/preview.js";

/**
 * Invoice builder routes — Plus/Pro tier, role-gated.
 *
 * FREE tier receives a 402-style upgrade error; reads are available to any
 * role with `invoices:read` so the dashboard can feature-gate gracefully.
 */

const templateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  config: z.unknown(),
});

const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2MB

export async function uploadTemplateLogo(c: Context) {
  const auth = await requirePermission(c, "invoices:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const featureGate = await guardInvoiceBuilderFeature(auth.team.teamId);
  if (featureGate) return c.json({ ok: false, ...featureGate }, 402 as any);

  const formData = await c.req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return c.json({ ok: false, error: "A file upload named 'file' is required" }, 422 as any);
  }
  const isPng = file.type === "image/png";
  const isJpeg = file.type === "image/jpeg" || file.type === "image/jpg";
  if (!isPng && !isJpeg) {
    return c.json({ ok: false, error: "Logo must be a PNG or JPEG image" }, 415 as any);
  }
  if (file.size > LOGO_MAX_BYTES) {
    return c.json({ ok: false, error: "Logo must be 2MB or smaller" }, 413 as any);
  }

  const teamId = auth.team.teamId;
  const objectKey = `assets/${teamId}/${randomUUID()}.${isPng ? "png" : "jpg"}`;
  const absPath = path.join(INVOICE_STORAGE_DIR, objectKey);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, Buffer.from(await file.arrayBuffer()));

  return c.json({ ok: true, data: { objectKey } }, 201 as any);
}


const previewBodySchema = z.object({
  config: z.unknown(),
  kind: z.enum(["invoice", "receipt"]).default("invoice"),
});

async function resolveEnvironmentId(
  c: Context,
  auth: { session: unknown; team: { teamId: string } },
) {
  const environment = await findResolvedActiveEnvironment(
    auth.session as { sessionId: string; activeEnvironmentId: string | null },
    auth.team.teamId,
  );
  return environment?.id ?? null;
}

async function guardInvoiceBuilderFeature(teamId: string) {
  const gate = await assertTierFeature(teamId, "invoiceBuilder");
  if (gate.allowed) return null;
  return {
    error: "INVOICE_BUILDER_REQUIRES_UPGRADE",
    message: `The invoice builder is available on ${gate.upgradeRequired} and above. Upgrade to unlock custom invoice design, logo, and branding.`,
  };
}

export async function listTemplates(c: Context) {
  const auth = await requirePermission(c, "invoices:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const environmentId = await resolveEnvironmentId(c, auth);
  const templates = await listInvoiceTemplates({
    teamId: auth.team.teamId,
    environmentId,
  });
  const builder = await assertTierFeature(auth.team.teamId, "invoiceBuilder");
  return c.json({
    ok: true,
    data: templates,
    builderAvailable: builder.allowed,
    upgradeRequired: builder.allowed ? null : builder.upgradeRequired,
  });
}

export async function getTemplate(c: Context) {
  const auth = await requirePermission(c, "invoices:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const template = await getInvoiceTemplate({
    teamId: auth.team.teamId,
    id: c.req.param("id")!,
  });
  if (!template) return c.json({ ok: false, error: "Template not found" }, 404 as any);
  return c.json({ ok: true, data: template });
}

export async function createTemplate(c: Context) {
  const auth = await requirePermission(c, "invoices:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const featureGate = await guardInvoiceBuilderFeature(auth.team.teamId);
  if (featureGate) return c.json({ ok: false, ...featureGate }, 402 as any);

  const body = await c.req.json().catch(() => null);
  const parsed = templateBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      422 as any,
    );
  }

  const validated = validateInvoiceTemplateConfig(parsed.data.config);
  if (!validated.ok) {
    return c.json(
      { ok: false, error: "INVALID_TEMPLATE_CONFIG", details: validated.errors },
      422 as any,
    );
  }

  const environmentId = await resolveEnvironmentId(c, auth);
  try {
    const result = await createInvoiceTemplate({
      teamId: auth.team.teamId,
      environmentId,
      name: parsed.data.name,
      description: parsed.data.description,
      config: validated.config,
    });
    return c.json({ ok: true, data: result }, 201 as any);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create template";
    const conflict =
      message.includes("Unique constraint") ||
      message.includes("InvoiceTemplate_teamId_environmentId_name_key");
    return c.json(
      { ok: false, error: conflict ? "Template name already exists in this environment" : message },
      conflict ? 409 : 400 as any,
    );
  }
}
export async function updateTemplate(c: Context) {
  const auth = await requirePermission(c, "invoices:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const featureGate = await guardInvoiceBuilderFeature(auth.team.teamId);
  if (featureGate) return c.json({ ok: false, ...featureGate }, 402 as any);

  const body = await c.req.json().catch(() => null);
  const parsed = templateBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      422 as any,
    );
  }

  const validated = validateInvoiceTemplateConfig(parsed.data.config);
  if (!validated.ok) {
    return c.json(
      { ok: false, error: "INVALID_TEMPLATE_CONFIG", details: validated.errors },
      422 as any,
    );
  }

  const result = await updateInvoiceTemplate({
    teamId: auth.team.teamId,
    id: c.req.param("id")!,
    name: parsed.data.name,
    description: parsed.data.description,
    config: validated.config,
  });
  if (!result) return c.json({ ok: false, error: "Template not found" }, 404 as any);
  return c.json({ ok: true, data: result });
}

export async function deleteTemplate(c: Context) {
  const auth = await requirePermission(c, "invoices:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const deleted = await deleteInvoiceTemplate({
    teamId: auth.team.teamId,
    id: c.req.param("id")!,
  });
  if (!deleted) return c.json({ ok: false, error: "Template not found" }, 404 as any);
  return c.json({ ok: true });
}

export async function activateTemplate(c: Context) {
  const auth = await requirePermission(c, "invoices:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const featureGate = await guardInvoiceBuilderFeature(auth.team.teamId);
  if (featureGate) return c.json({ ok: false, ...featureGate }, 402 as any);

  const environmentId = await resolveEnvironmentId(c, auth);
  const result = await activateInvoiceTemplate({
    teamId: auth.team.teamId,
    id: c.req.param("id")!,
    environmentId,
  });
  if (!result) return c.json({ ok: false, error: "Template not found" }, 404 as any);
  return c.json({ ok: true, data: result });
}

export async function duplicateTemplate(c: Context) {
  const auth = await requirePermission(c, "invoices:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const featureGate = await guardInvoiceBuilderFeature(auth.team.teamId);
  if (featureGate) return c.json({ ok: false, ...featureGate }, 402 as any);

  const source = await getInvoiceTemplate({
    teamId: auth.team.teamId,
    id: c.req.param("id")!,
  });
  if (!source) return c.json({ ok: false, error: "Template not found" }, 404 as any);

  const environmentId = await resolveEnvironmentId(c, auth);
  const result = await duplicateInvoiceTemplate({
    teamId: auth.team.teamId,
    environmentId,
    id: source.id,
    name: `${source.name} (copy)`,
  });
  if (!result) return c.json({ ok: false, error: "Template not found" }, 404 as any);
  return c.json({ ok: true, data: result }, 201 as any);
}

export async function previewTemplate(c: Context) {
  const auth = await requirePermission(c, "invoices:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const featureGate = await guardInvoiceBuilderFeature(auth.team.teamId);
  if (featureGate) return c.json({ ok: false, ...featureGate }, 402 as any);

  const body = await c.req.json().catch(() => null);
  const parsed = previewBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      422 as any,
    );
  }

  const validated = validateInvoiceTemplateConfig(parsed.data.config);
  if (!validated.ok) {
    return c.json(
      { ok: false, error: "INVALID_TEMPLATE_CONFIG", details: validated.errors },
      422 as any,
    );
  }

  const environmentId = await resolveEnvironmentId(c, auth);
  const context = await buildSampleInvoiceContext({
    teamId: auth.team.teamId,
    environmentId,
  });
  const bytes = await renderTemplateInvoicePdf(
    { kind: parsed.data.kind, context },
    validated.config,
  );
  return c.body(Buffer.from(bytes), 200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": 'inline; filename="invoice-preview.pdf"',
    "Cache-Control": "no-store",
  });
}

export async function getDefaultConfig(c: Context) {
  const auth = await requirePermission(c, "invoices:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);
  return c.json({ ok: true, data: buildDefaultInvoiceTemplateConfig() });
}

