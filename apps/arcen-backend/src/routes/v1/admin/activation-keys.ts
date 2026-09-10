import { Hono } from "hono";
import { z } from "zod";
import { requireAdminAuth } from "../../../middleware/auth.js";
import { db } from "../../../db.js";
import { ActivationKeyService } from "../../../services/activation-key.service.js";
import { RESEND_API_KEY, EMAIL_FROM_ADMIN, APP_URL } from "../../../config.js";
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

export function buildEnterpriseActivationEmailHtml(params: {
  key: string;
  tier: string;
  maxUses: number;
  recipientEmail?: string;
  expiresAt?: Date | string | null;
  notes?: string | null;
  customMessage?: string;
}): string {
  const dashUrl = APP_URL ?? "https://app.arcenpay.com";
  const tierMap: Record<string, string> = { FREE: "Free", PLUS: "Plus", PRO: "Pro" };
  const tierLabel = tierMap[params.tier] ?? params.tier;
  const activationUrl = `${dashUrl}/onboarding/activation?key=${encodeURIComponent(params.key)}`;
  const expiresFormatted = params.expiresAt ? new Date(params.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Your ArcenPay Activation Key</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:48px 16px;background-color:#f8fafc;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="max-width:540px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05),0 2px 4px -2px rgba(0,0,0,0.05);overflow:hidden;text-align:left;">
        <!-- Top brand accent banner -->
        <tr><td style="height:5px;background:linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%);"></td></tr>
        <tr><td style="padding:40px 36px;">
          <!-- Brand Header -->
          <div style="margin-bottom:28px;">
            <span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#0f172a;">Arcen<span style="color:#4f46e5;">Pay</span></span>
            <span style="display:inline-block;margin-left:10px;padding:3px 10px;background-color:#eef2ff;color:#4f46e5;font-size:12px;font-weight:700;border-radius:9999px;vertical-align:middle;text-transform:uppercase;letter-spacing:0.5px;">${tierLabel} Plan</span>
          </div>

          <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0f172a;line-height:1.3;letter-spacing:-0.3px;">
            Your ${tierLabel} Workspace is Ready
          </h1>
          <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6;">
            You've been invited to activate your <strong style="color:#0f172a;">${tierLabel}</strong> workspace on ArcenPay. Use your unique platform activation key below to unlock the Web3 billing infrastructure and control plane.
          </p>

          ${params.customMessage ? `<div style="background-color:#f1f5f9;border-left:4px solid #4f46e5;padding:14px 18px;margin-bottom:24px;border-radius:0 8px 8px 0;font-size:14px;color:#334155;line-height:1.5;">${params.customMessage}</div>` : ""}

          <!-- Key Box -->
          <div style="background-color:#f5f3ff;border:2px dashed #c7d2fe;border-radius:12px;padding:24px 20px;margin:24px 0;text-align:center;">
            <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:1.5px;">Platform Activation Key</p>
            <div style="margin:0 0 10px;font-size:24px;font-weight:800;color:#312e81;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;letter-spacing:2.5px;">
              ${params.key}
            </div>
            <div style="font-size:12px;color:#6b21a8;font-weight:500;">
              Valid for <strong>${params.maxUses} workspace${params.maxUses > 1 ? "s" : ""}</strong>${expiresFormatted ? ` &bull; Expires ${expiresFormatted}` : ""}
            </div>
            ${params.notes ? `<div style="margin-top:6px;font-size:11px;color:#7c3aed;">Note: ${params.notes}</div>` : ""}
          </div>

          <!-- CTA Button -->
          <div style="text-align:center;margin:32px 0;">
            <a href="${activationUrl}"
               style="display:inline-block;padding:14px 36px;background-color:#4f46e5;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;box-shadow:0 4px 6px -1px rgba(79,70,229,0.3);letter-spacing:0.2px;">
              Activate Workspace &rarr;
            </a>
          </div>

          <!-- Quick instructions -->
          <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin:24px 0;">
            <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1e293b;">How to activate:</p>
            <ol style="margin:0;padding-left:18px;font-size:13px;color:#475569;line-height:1.7;">
              <li>Click the button above or visit <a href="${dashUrl}" style="color:#4f46e5;text-decoration:none;font-weight:500;">${dashUrl}</a></li>
              <li>Sign in or create your account with your email</li>
              <li>Enter your activation key to unlock the dashboard</li>
            </ol>
          </div>

          <hr style="margin:32px 0 20px;border:none;border-top:1px solid #f1f5f9;" />
          <p style="margin:0 0 6px;font-size:12px;color:#64748b;line-height:1.5;">
            Sent by the ArcenPay Platform Admin Team (<a href="mailto:hello@arcenpay.com" style="color:#4f46e5;text-decoration:none;">hello@arcenpay.com</a>).
          </p>
          <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
            Questions or need assistance? Reply directly to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendActivationEmail(to: string, subject: string, key: { key: string; tier: string; maxUses: number; expiresAt?: Date | string | null; notes?: string | null }): Promise<{ error?: string }> {
  const resend = new Resend(RESEND_API_KEY);
  const html = buildEnterpriseActivationEmailHtml({
    key: key.key,
    tier: key.tier,
    maxUses: key.maxUses,
    recipientEmail: to,
    expiresAt: key.expiresAt,
    notes: key.notes,
  });

  const { error } = await resend.emails.send({
    from: EMAIL_FROM_ADMIN || "hello@arcenpay.com",
    to: [to],
    subject,
    html,
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
    const customMessage = parse.data.message ?? "";
    const subject = parse.data.subject ?? "Get Started with ArcenPay — Free Plan";
    const emailHtml = buildEnterpriseActivationEmailHtml({
      key: usableKey.key,
      tier: "FREE",
      maxUses: usableKey.maxUses,
      notes: "Free Tier activation for new workspaces",
      customMessage: customMessage || undefined,
    });
    let sent = 0, errors = 0;
    for (const team of inactiveTeams) {
      const profile = team.profileData as Record<string, unknown> | null;
      const email = typeof profile?.contactEmail === "string" ? profile.contactEmail : typeof profile?.billingEmail === "string" ? profile.billingEmail : null;
      if (!email) continue;
      try {
        const { error } = await resend.emails.send({
          from: EMAIL_FROM_ADMIN || "hello@arcenpay.com",
          to: [email],
          subject,
          html: emailHtml,
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
    let sent = 0, errors = 0;
    for (const email of to) {
      try {
        const html = keyData
          ? buildEnterpriseActivationEmailHtml({
              key: keyData.key,
              tier: keyData.tier,
              maxUses: keyData.maxUses,
              recipientEmail: email,
              expiresAt: keyData.expiresAt,
              notes: keyData.notes,
              customMessage: message || undefined,
            })
          : `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 16px;background-color:#f8fafc;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);overflow:hidden;text-align:left;">
        <tr><td style="height:5px;background:linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%);"></td></tr>
        <tr><td style="padding:40px 36px;">
          <div style="margin-bottom:28px;">
            <span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#0f172a;">Arcen<span style="color:#4f46e5;">Pay</span></span>
          </div>
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;line-height:1.3;">${subject}</h1>
          <div style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:28px;">
            ${message ? message.replace(/\n/g, "<br/>") : "We are excited to announce that ArcenPay is live. Build, manage, and scale your on-chain billing infrastructure."}
          </div>
          <hr style="margin:32px 0 20px;border:none;border-top:1px solid #f1f5f9;" />
          <p style="margin:0;font-size:12px;color:#64748b;">
            Sent by the ArcenPay Platform Admin Team (<a href="mailto:hello@arcenpay.com" style="color:#4f46e5;text-decoration:none;">hello@arcenpay.com</a>).
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

        const { error } = await resend.emails.send({
          from: EMAIL_FROM_ADMIN || "hello@arcenpay.com",
          to: [email],
          subject,
          html,
        });
        if (error) { errors++; } else { sent++; }
      } catch { errors++; }
    }
    return c.json({ ok: true, message: "Sent to " + sent + " (" + errors + " errors)", sentCount: sent, errorCount: errors });
  });