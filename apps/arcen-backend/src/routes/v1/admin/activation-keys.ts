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
  const expiresFormatted = params.expiresAt
    ? new Date(params.expiresAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const escapedKey = params.key
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const escapedNotes = params.notes
    ? params.notes
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
    : null;
  const escapedCustomMessage = params.customMessage
    ? params.customMessage
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
    : null;
  const escapedRecipient = params.recipientEmail?.trim()
    ? params.recipientEmail
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
    : null;
  const preferencesUrl = `${dashUrl}/settings/notifications`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${tierLabel} Workspace Activation — ArcenPay</title>
</head>
<body style="margin:0;padding:0;background-color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#0a0a0a;">
  <!-- Outer Canvas Table -->
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#fafafa;margin:0;padding:40px 16px 60px;">
    <tr>
      <td align="center" style="margin:0;padding:0;">
        <!-- Centered Email Card (max 560px) -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 8px 24px -4px rgba(0,0,0,0.03);text-align:left;">

          <!-- Brand Header: Official Logo -->
          <tr>
            <td style="padding:28px 36px 20px 36px;background-color:#ffffff;">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="vertical-align:middle;line-height:0;">
                    <a href="${dashUrl}" style="text-decoration:none;display:inline-block;">
                      <img src="https://files.catbox.moe/dzpc14.png" alt="ArcenPay" width="138" height="34" style="display:block;height:32px;width:auto;border:0;outline:none;" />
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Subtle Divider -->
          <tr>
            <td style="padding:0 36px;">
              <div style="height:1px;background-color:#f4f4f5;line-height:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Main Content Slot -->
          <tr>
            <td style="padding:28px 36px 32px 36px;background-color:#ffffff;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">

                <!-- Eyebrow Category -->
                <tr>
                  <td style="padding:0 0 10px 0;">
                    <div style="font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;">
                      Enterprise Workspace Provisioning
                    </div>
                  </td>
                </tr>

                <!-- Main Heading -->
                <tr>
                  <td style="padding:0 0 14px 0;">
                    <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:#0a0a0a;letter-spacing:-0.02em;">
                      Your ${tierLabel} workspace is ready
                    </h1>
                  </td>
                </tr>

                <!-- Intro Paragraph -->
                <tr>
                  <td style="padding:0 0 20px 0;font-size:14px;line-height:22px;color:#3f3f46;">
                    An enterprise workspace license has been provisioned on ArcenPay. Your environment includes dedicated facilitator relay, high-throughput ZK verification, and programmable subscription controls.
                  </td>
                </tr>

                ${
                  escapedCustomMessage
                    ? `
                <tr>
                  <td style="padding:0 0 20px 0;">
                    <div style="background-color:#fafafa;border:1px solid #e4e4e7;border-radius:8px;padding:12px 16px;font-size:13px;color:#3f3f46;line-height:20px;">
                      <strong style="color:#0a0a0a;">Note:</strong> ${escapedCustomMessage}
                    </div>
                  </td>
                </tr>`
                    : ""
                }

                <!-- Activation Key Card -->
                <tr>
                  <td style="padding:0 0 24px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e4e4e7;border-radius:10px;background-color:#fafafa;padding:18px 20px;">
                      <tr>
                        <td>
                          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:6px;">
                            <tr>
                              <td align="left" style="font-size:11px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">
                                Platform Activation Key
                              </td>
                              <td align="right" style="font-size:12px;color:#71717a;">
                                ${params.maxUses} workspace${params.maxUses > 1 ? "s" : ""}${expiresFormatted ? ` &middot; Expires ${expiresFormatted}` : ""}
                              </td>
                            </tr>
                          </table>
                          <div style="font-size:22px;font-weight:700;color:#0a0a0a;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;letter-spacing:1.5px;padding:6px 0 2px 0;">
                            ${escapedKey}
                          </div>
                          ${escapedNotes ? `<div style="margin-top:6px;font-size:12px;color:#71717a;">Reference: <span style="color:#0a0a0a;">${escapedNotes}</span></div>` : ""}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Primary CTA Button -->
                <tr>
                  <td style="padding:0 0 24px 0;">
                    <table cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="border-radius:8px;background-color:#0a0a0a;">
                          <a href="${activationUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 28px;color:#ffffff;background-color:#0a0a0a;border:1px solid #0a0a0a;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;text-align:center;">
                            Activate workspace &rarr;
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Provisioned Specifications Summary -->
                <tr>
                  <td style="padding:0 0 24px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e4e4e7;border-radius:10px;background-color:#ffffff;overflow:hidden;">
                      <tr>
                        <td style="padding:10px 16px;border-bottom:1px solid #f4f4f5;font-size:13px;color:#71717a;">Workspace Tier</td>
                        <td style="padding:10px 16px;border-bottom:1px solid #f4f4f5;font-size:13px;font-weight:600;color:#0a0a0a;" align="right">${tierLabel}</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 16px;border-bottom:1px solid #f4f4f5;font-size:13px;color:#71717a;">Settlement Engine</td>
                        <td style="padding:10px 16px;border-bottom:1px solid #f4f4f5;font-size:13px;font-weight:600;color:#0a0a0a;" align="right">High-Throughput Rollup</td>
                      </tr>
                      <tr>
                        <td style="padding:10px 16px;font-size:13px;color:#71717a;">Autonomous Agent Module</td>
                        <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#0a0a0a;" align="right">Enabled (x402)</td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Sign-off -->
                <tr>
                  <td style="padding:0;font-size:13px;line-height:20px;color:#71717a;">
                    Questions about your enterprise deployment? Reach out to <a href="mailto:hello@arcenpay.com" target="_blank" rel="noopener noreferrer" style="color:#0001fd;text-decoration:underline;font-weight:500;">hello@arcenpay.com</a>.
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer Divider -->
          <tr>
            <td style="padding:0 36px;">
              <div style="height:1px;background-color:#f4f4f5;line-height:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Footer Area -->
          <tr>
            <td style="padding:24px 36px 32px 36px;background-color:#fafafa;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding:0 0 10px 0;font-size:12px;line-height:18px;color:#71717a;">
                    ${
                      escapedRecipient
                        ? `This email was sent to <a href="mailto:${escapedRecipient}" style="color:#71717a;text-decoration:underline;">${escapedRecipient}</a>. To change which emails you receive, <a href="${preferencesUrl}" style="color:#71717a;text-decoration:underline;">manage your notification settings</a>.`
                        : `To manage your email preferences, visit your <a href="${preferencesUrl}" style="color:#71717a;text-decoration:underline;">notification settings</a>.`
                    }
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 20px 0;font-size:12px;line-height:18px;color:#71717a;">
                    &copy; 2026 ArcenPay Protocol. All rights reserved.
                  </td>
                </tr>
                <tr>
                  <td>
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <!-- Left: Mini Brand Logo -->
                        <td align="left" style="vertical-align:middle;">
                          <a href="${dashUrl}" style="text-decoration:none;display:inline-block;">
                            <img src="https://files.catbox.moe/dzpc14.png" alt="ArcenPay" width="92" height="23" style="display:block;height:22px;width:auto;border:0;outline:none;opacity:0.85;" />
                          </a>
                        </td>

                        <!-- Right: Clean Social Icons (X, LinkedIn, GitHub) -->
                        <td align="right" style="vertical-align:middle;">
                          <table cellpadding="0" cellspacing="0" role="presentation">
                            <tr>
                              <!-- X (Twitter) -->
                              <td style="padding-left:14px;">
                                <a href="https://x.com/arcenpayhq" style="display:inline-block;color:#71717a;text-decoration:none;" title="X (Twitter)">
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;color:#71717a;">
                                    <path d="M4 4l11.733 16h4.267l-11.733 -16z"></path>
                                    <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"></path>
                                  </svg>
                                </a>
                              </td>
                              <!-- LinkedIn -->
                              <td style="padding-left:14px;">
                                <a href="https://www.linkedin.com/company/arcenpay" style="display:inline-block;color:#71717a;text-decoration:none;" title="LinkedIn">
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;color:#71717a;">
                                    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
                                    <rect x="2" y="9" width="4" height="12"></rect>
                                    <circle cx="4" cy="4" r="2"></circle>
                                  </svg>
                                </a>
                              </td>
                              <!-- GitHub -->
                              <td style="padding-left:14px;">
                                <a href="https://github.com/arcenpay" style="display:inline-block;color:#71717a;text-decoration:none;" title="GitHub">
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;color:#71717a;">
                                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                                  </svg>
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
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