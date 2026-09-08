import { Hono } from "hono";
import { z } from "zod";
import { requireAdminAuth } from "../../../middleware/auth.js";
import { db } from "../../../db.js";
import { ActivationKeyService } from "../../../services/activation-key.service.js";
import { RESEND_API_KEY, EMAIL_FROM, APP_URL } from "../../../config.js";
import { Resend } from "resend";
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

const revokeKeySchema = z.object({ reason: z.string().optional() });

async function sendActivationEmail(to: string, subject: string, key: { key: string; tier: string; maxUses: number; expiresAt?: Date | string | null; notes?: string | null }): Promise<{ error?: string }> {
  const resend = new Resend(RESEND_API_KEY);
  const dashUrl = APP_URL ?? "https://app.arcenpay.com";
  const tierMap: Record<string, string> = { FREE: "Free", PLUS: "Plus", PRO: "Pro" };
  const tierLabel = tierMap[key.tier as string] ?? key.tier;
  const { error } = await resend.emails.send({
    from: EMAIL_FROM || "noreply@arcenpay.com",
    to: [to],
    subject,
    html: `
<!DOCTYPE html>
<html><head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#111113;border:1px solid #222225;border-radius:12px;padding:40px;">
        <tr><td>
          <p style="margin:0 0 32px;font-size:22px;font-weight:700;color:#ffffff;">ArcenPay</p>
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#ffffff;">Your ${tierLabel} Plan Awaits</h1>
          <p style="margin:0 0 20px;font-size:14px;color:#888;line-height:1.6;">
            You've been invited to activate a <strong style="color:#ccc;">${tierLabel}</strong> workspace.
            Use the key below to unlock your ArcenPay billing infrastructure.
          </p>
          <div style="background:#1a1a1c;border:1px solid #2a2a2c;border-radius:8px;padding:16px;margin:20px 0;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;">Activation Key</p>
            <p style="margin:0;font-size:20px;font-weight:700;color:#6366f1;font-family:monospace;letter-spacing:2px;">${key.key}</p>
          </div>
          <ol style="margin:0 0 28px;padding-left:20px;font-size:13px;color:#888;line-height:2;">
            <li>Go to <a href="${dashUrl}" style="color:#6366f1;">${dashUrl}</a></li>
            <li>Sign in or create your account</li>
            <li>Enter the activation key during onboarding</li>
          </ol>
          <p style="margin:0;font-size:12px;color:#666;line-height:1.5;">
            This key grants <strong>${key.maxUses} workspace${key.maxUses > 1 ? "s" : ""}</strong>
            ${key.expiresAt ? `and expires on ${new Date(key.expiresAt).toLocaleDateString()}.` : "."}
            ${key.notes ? `<br/>Note: ${key.notes}` : ""}
          </p>
          <hr style="margin:32px 0;border:none;border-top:1px solid #222225;" />
          <p style="margin:0;font-size:12px;color:#444;">Questions? Reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
  return { error: error?.message };
}

export const adminActivationKeysRouter = new Hono()
  .post("/verify-secret", requireAdminAuth(), async (c) => c.json({ ok: true, message: "Admin authenticated" }))
  .get("/analytics", requireAdminAuth(), async (c) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [totalTeams, activatedTeams, totalUsers, paidTeams, totalKeys, activeKeys, totalRedemptions, recentTeams, recentRedemptions, keysByTier, teamsByTier] = await Promise.all([
      db.team.count(),
      db.team.count({ where: { isPlatformActivated: true } }),
      db.user.count(),
      db.team.count({ where: { platformTier: { in: ["PLUS", "PRO"] } } }),
      db.platformActivationKey.count(),
      db.platformActivationKey.count({ where: { status: "ACTIVE" } }),
      db.platformActivationRedemption.count(),
      db.team.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, slug: true, platformTier: true, isPlatformActivated: true, createdAt: true } }),
      db.platformActivationRedemption.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, orderBy: { createdAt: "desc" }, take: 10, include: { team: { select: { name: true, slug: true } } } }),
      db.platformActivationKey.groupBy({ by: ["tier"], _count: { id: true } }),
      db.team.groupBy({ by: ["platformTier"], _count: { id: true } }),
    ]);
    return c.json({ ok: true, data: {
      overview: {
        totalTeams, activatedTeams,
        activationRate: totalTeams > 0 ? Math.round((activatedTeams / totalTeams) * 100) : 0,
        totalUsers, paidTeams, totalKeys, activeKeys, totalRedemptions,
      },
      recentTeams: recentTeams.map((t) => ({ id: t.id, name: t.name, slug: t.slug, tier: t.platformTier, activated: t.isPlatformActivated, createdAt: t.createdAt.toISOString() })),
      recentRedemptions: recentRedemptions.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), teamName: r.team?.name ?? r.teamId, teamSlug: r.team?.slug ?? "" })),
      keysByTier: keysByTier.map((k) => ({ tier: k.tier, count: k._count.id })),
      teamsByTier: teamsByTier.map((t) => ({ tier: t.platformTier, count: t._count.id })),
    }});
  })
  .get("/stats", requireAdminAuth(), async (c) => { const stats = await ActivationKeyService.getActivationKeyStats(); return c.json({ ok: true, data: stats }); })
  .get("/", requireAdminAuth(), async (c) => {
    const search = c.req.query("search");
    const status = c.req.query("status") as ActivationKeyStatus | undefined;
    const tier = c.req.query("tier") as PlatformTier | undefined;
    const limit = parseInt(c.req.query("limit") || "50", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);
    const result = await ActivationKeyService.listActivationKeys({ search, status, tier, limit, offset });
    return c.json({ ok: true, ...result });
  })
  .post("/", requireAdminAuth(), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parse = createKeySchema.safeParse(body);
    if (!parse.success) return c.json({ ok: false, error: parse.error.errors[0]?.message || "Invalid input" }, 400 as any);
    const d = parse.data;
    const created = await ActivationKeyService.createActivationKey({ name: d.name, key: d.key, tier: d.tier, allowPlatformBilling: d.allowPlatformBilling, maxUses: d.maxUses, recipientEmail: d.recipientEmail || undefined, recipientName: d.recipientName, expiresAt: d.expiresAt || undefined, notes: d.notes, metadata: d.metadata });
    return c.json({ ok: true, data: created }, 201 as any);
  })
  .post("/send-email", requireAdminAuth(), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parse = z.object({ keyId: z.string().min(1), to: z.string().email(), subject: z.string().optional() }).safeParse(body);
    if (!parse.success) return c.json({ ok: false, error: "Invalid request" }, 400 as any);
    const key = await ActivationKeyService.getActivationKeyById(parse.data.keyId);
    if (!key) return c.json({ ok: false, error: "Key not found" }, 404 as any);
    const result = await sendActivationEmail(parse.data.to, parse.data.subject ?? `Your ${key.tier} Activation Key`, key);
    if (result.error) return c.json({ ok: false, error: `Email failed: ${result.error}` }, 500 as any);
    return c.json({ ok: true, message: `Sent to ${parse.data.to}` });
  })
  .post("/bulk-email-free", requireAdminAuth(), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parse = z.object({ subject: z.string().optional(), message: z.string().optional() }).safeParse(body);
    if (!parse.success) return c.json({ ok: false, error: "Invalid request" }, 400 as any);
    const freeKeys = await db.platformActivationKey.findMany({
      where: { tier: "FREE", status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { id: true, key: true, name: true, maxUses: true, usedCount: true },
    });
    const usableKey = freeKeys.filter((k) => k.usedCount < k.maxUses).sort((a, b) => (b.maxUses - b.usedCount) - (a.maxUses - a.usedCount))[0];
    if (!usableKey) return c.json({ ok: false, error: "No FREE keys with remaining capacity. Create one first." }, 400 as any);
    const inactiveTeams = await db.team.findMany({ where: { isPlatformActivated: false }, select: { id: true, name: true, slug: true, profileData: true }, take: 200 });
    const resend = new Resend(RESEND_API_KEY);
    const dashUrl = APP_URL ?? "https://app.arcenpay.com";
    const customMessage = parse.data.message ?? "";
    const subject = parse.data.subject ?? "Get Started with ArcenPay — Free Plan";
    let sent = 0, errors = 0;
    for (const team of inactiveTeams) {
      const profile = team.profileData as Record<string, unknown> | null;
      const email = typeof profile?.contactEmail === "string" ? profile.contactEmail : typeof profile?.billingEmail === "string" ? profile.billingEmail : null;
      if (!email) continue;
      try {
        const { error } = await resend.emails.send({
          from: EMAIL_FROM || "noreply@arcenpay.com", to: [email], subject,
          html: `<!DOCTYPE html><html><head><meta charset="UTF-8" /></head><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center"><table width="480" cellpadding="0" cellspacing="0" style="background:#111113;border:1px solid #222225;border-radius:12px;padding:40px;"><tr><td><p style="margin:0 0 32px;font-size:22px;font-weight:700;color:#ffffff;">ArcenPay</p><h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#ffffff;">Your Free Plan is Ready</h1><p style="margin:0 0 20px;font-size:14px;color:#888;line-height:1.6;">Welcome to ArcenPay! Your <strong style="color:#ccc;">Free</strong> workspace is ready.${customMessage ? `<br/><br/>${customMessage}` : ""}</p><div style="background:#1a1a1c;border:1px solid #2a2a2c;border-radius:8px;padding:16px;margin:20px 0;text-align:center;"><p style="margin:0 0 6px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;">Activation Key</p><p style="margin:0;font-size:20px;font-weight:700;color:#6366f1;font-family:monospace;letter-spacing:2px;">${usableKey.key}</p></div><ol style="margin:0 0 28px;padding-left:20px;font-size:13px;color:#888;line-height:2;"><li>Go to <a href="${dashUrl}" style="color:#6366f1;">${dashUrl}</a></li><li>Sign in with your email</li><li>Enter the activation key above</li></ol><hr style="margin:32px 0;border:none;border-top:1px solid #222225;" /><p style="margin:0;font-size:12px;color:#444;">Questions? Reply to this email.</p></td></tr></table></td></tr></table></body></html>`,
        });
        if (error) { errors++; } else { sent++; }
      } catch { errors++; }
    }
    return c.json({ ok: true, message: `Sent to ${sent} recipients (${errors} errors)`, sentCount: sent, errorCount: errors });
  })
  .get("/:id", requireAdminAuth(), async (c) => {
    const id = c.req.param("id");
    const key = await ActivationKeyService.getActivationKeyById(id);
    if (!key) return c.json({ ok: false, error: "Not found" }, 404 as any);
    return c.json({ ok: true, data: key });
  })
  .post("/:id/revoke", requireAdminAuth(), async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parse = revokeKeySchema.safeParse(body);
    const reason = parse.success ? parse.data.reason : undefined;
    try { const r = await ActivationKeyService.revokeActivationKey(id, reason); return c.json({ ok: true, data: r }); }
    catch (err) { return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400 as any); }
  })
  .post("/:id/reactivate", requireAdminAuth(), async (c) => {
    const id = c.req.param("id");
    try { const r = await ActivationKeyService.reactivateActivationKey(id); return c.json({ ok: true, data: r }); }
    catch (err) { return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400 as any); }
  })
  .post("/announce", requireAdminAuth(), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parse = z.object({
      to: z.array(z.string().email()).min(1, "At least one recipient required"),
      subject: z.string().min(1).default("ArcenPay is Live!"),
      message: z.string().optional(),
      keyId: z.string().optional(),
      includeKey: z.boolean().default(false),
    }).safeParse(body);
    if (!parse.success) return c.json({ ok: false, error: "Invalid request" }, 400 as any);
    const { to, subject, message, keyId, includeKey } = parse.data;
    let keyData = null;
    if (includeKey || keyId) {
      if (keyId) {
        keyData = await ActivationKeyService.getActivationKeyById(keyId);
      } else {
        keyData = await db.platformActivationKey.findFirst({
          where: { tier: "FREE", status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          orderBy: { createdAt: "desc" },
        });
      }
    }
    const resend = new Resend(RESEND_API_KEY);
    const dashUrl = APP_URL ?? "https://app.arcenpay.com";
    const baseStart = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\" /></head><body style=\"margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\"><table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"padding:40px 16px;\"><tr><td align=\"center\"><table width=\"480\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#111113;border:1px solid #222225;border-radius:12px;padding:40px;\"><tr><td><p style=\"margin:0 0 32px;font-size:22px;font-weight:700;color:#ffffff;\">ArcenPay</p>";
    const baseEnd = "<hr style=\"margin:32px 0;border:none;border-top:1px solid #222225;\" /><p style=\"margin:0;font-size:12px;color:#444;\">Questions? Reply to this email.</p></td></tr></table></td></tr></table></body></html>";
    let sent = 0, errors = 0;
    for (const email of to) {
      try {
        const content = message ? message.replace(/\n/g, "<br/>") : "<h1 style=\"margin:0 0 12px;font-size:20px;font-weight:600;color:#ffffff;\">ArcenPay is Live!</h1><p style=\"margin:0 0 20px;font-size:14px;color:#888;line-height:1.6;\">We are excited to announce that ArcenPay is live. Build your billing infrastructure on-chain.</p>";
        const keyBox = keyData ? "<div style=\"background:#1a1a1c;border:1px solid #2a2a2c;border-radius:8px;padding:16px;margin:20px 0;text-align:center;\"><p style=\"margin:0 0 6px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;\">Activation Key</p><p style=\"margin:0;font-size:20px;font-weight:700;color:#6366f1;font-family:monospace;letter-spacing:2px;\">" + keyData.key + "</p></div>" : "";
        const { error } = await resend.emails.send({
          from: EMAIL_FROM || "noreply@arcenpay.com", to: [email], subject,
          html: baseStart + content + keyBox + baseEnd
        });
        if (error) { errors++; } else { sent++; }
      } catch { errors++; }
    }
    return c.json({ ok: true, message: "Sent to " + sent + " (" + errors + " errors)", sentCount: sent, errorCount: errors });
  });