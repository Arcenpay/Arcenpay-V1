import { Hono } from "hono";
import { z } from "zod";
import { requireAdminAuth } from "../../../middleware/auth.js";
import { ActivationKeyService } from "../../../services/activation-key.service.js";
import type { ActivationKeyStatus, PlatformTier } from "../../../generated/client/client.js";

const createKeySchema = z.object({
  name: z.string().min(1, "Name is required"),
  key: z.string().optional(),
  tier: z.enum(["FREE", "PLUS", "PRO"]).default("PRO"),
  allowPlatformBilling: z.boolean().default(true),
  maxUses: z.number().int().positive().default(1),
  recipientEmail: z.string().email().optional().or(z.literal("")),
  recipientName: z.string().optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  notes: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const revokeKeySchema = z.object({
  reason: z.string().optional(),
});

export const adminActivationKeysRouter = new Hono()
  // Verify admin secret endpoint
  .post("/verify-secret", requireAdminAuth(), async (c) => {
    return c.json({ ok: true, message: "Admin authenticated successfully" });
  })
  // Stats overview
  .get("/stats", requireAdminAuth(), async (c) => {
    const stats = await ActivationKeyService.getActivationKeyStats();
    return c.json({ ok: true, data: stats });
  })
  // List keys
  .get("/", requireAdminAuth(), async (c) => {
    const search = c.req.query("search");
    const status = c.req.query("status") as ActivationKeyStatus | undefined;
    const tier = c.req.query("tier") as PlatformTier | undefined;
    const limitStr = c.req.query("limit");
    const offsetStr = c.req.query("offset");

    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    const result = await ActivationKeyService.listActivationKeys({
      search,
      status,
      tier,
      limit,
      offset,
    });

    return c.json({ ok: true, ...result });
  })
  // Create key
  .post("/", requireAdminAuth(), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parse = createKeySchema.safeParse(body);
    if (!parse.success) {
      return c.json({ ok: false, error: parse.error.errors[0]?.message || "Invalid input", code: "BAD_REQUEST" }, 400 as any);
    }

    const { name, key, tier, allowPlatformBilling, maxUses, recipientEmail, recipientName, expiresAt, notes, metadata } = parse.data;

    const created = await ActivationKeyService.createActivationKey({
      name,
      key,
      tier,
      allowPlatformBilling,
      maxUses,
      recipientEmail: recipientEmail || undefined,
      recipientName,
      expiresAt: expiresAt || undefined,
      notes,
      metadata,
    });

    return c.json({ ok: true, data: created }, 201 as any);
  })
  // Get key by ID with redemptions
  .get("/:id", requireAdminAuth(), async (c) => {
    const id = c.req.param("id");
    const key = await ActivationKeyService.getActivationKeyById(id);
    if (!key) {
      return c.json({ ok: false, error: "Activation key not found", code: "NOT_FOUND" }, 404 as any);
    }

    return c.json({ ok: true, data: key });
  })
  // Revoke key
  .post("/:id/revoke", requireAdminAuth(), async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parse = revokeKeySchema.safeParse(body);
    const reason = parse.success ? parse.data.reason : undefined;

    try {
      const result = await ActivationKeyService.revokeActivationKey(id, reason);
      return c.json({ ok: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: msg, code: "REVOKE_FAILED" }, 400 as any);
    }
  })
  // Reactivate key
  .post("/:id/reactivate", requireAdminAuth(), async (c) => {
    const id = c.req.param("id");
    try {
      const result = await ActivationKeyService.reactivateActivationKey(id);
      return c.json({ ok: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: msg, code: "REACTIVATE_FAILED" }, 400 as any);
    }
  });
