// ============================================================
//  Dashboard API — Provider Profile
//  GET  /api/provider/profile  — read profile for current session
//  PUT  /api/provider/profile  — upsert profile
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { requireTeamRoles, isErrorResponse } from "@/lib/api-auth";

const EMPTY_PROFILE = {
  providerName: null,
  website: null,
  contactEmail: null,
  notifyEmail: true,
  notifyWebhook: false,
  webhookUrl: null,
  apiKeyPrefix: null,
  // webhookSigningSecret intentionally omitted — write-only
};

const UpdateSchema = z.object({
  providerName: z.string().max(120).optional().or(z.literal("")),
  website: z.string().url("Invalid website URL").optional().or(z.literal("")),
  contactEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  notifyEmail: z.boolean().optional(),
  notifyWebhook: z.boolean().optional(),
  webhookUrl: z
    .string()
    .url("Invalid webhook URL")
    .optional()
    .or(z.literal("")),
  // Write-only: never returned to client
  webhookSigningSecret: z.string().min(16).max(256).optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const { team } = auth;
  const teamId = team.teamId;

  const profile = await db.providerProfile.findUnique({
    where: { teamId },
    select: {
      providerName: true,
      website: true,
      contactEmail: true,
      notifyEmail: true,
      notifyWebhook: true,
      webhookUrl: true,
      apiKeyPrefix: true,
      // webhookSigningSecret intentionally excluded — write-only
    },
  });

  return NextResponse.json(profile ?? EMPTY_PROFILE);
}

// ── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { team } = auth;
  const teamId = team.teamId;

  const d = parsed.data;
  const data: Record<string, unknown> = {};
  if (d.providerName !== undefined) data.providerName = d.providerName || null;
  if (d.website !== undefined) data.website = d.website || null;
  if (d.contactEmail !== undefined) data.contactEmail = d.contactEmail || null;
  if (d.notifyEmail !== undefined) data.notifyEmail = d.notifyEmail;
  if (d.notifyWebhook !== undefined) data.notifyWebhook = d.notifyWebhook;
  if (d.webhookUrl !== undefined) data.webhookUrl = d.webhookUrl || null;
  if (d.webhookSigningSecret !== undefined)
    data.webhookSigningSecret = d.webhookSigningSecret;

  const before = await db.providerProfile.findUnique({
    where: { teamId },
    select: {
      providerName: true,
      website: true,
      contactEmail: true,
      notifyEmail: true,
      notifyWebhook: true,
      webhookUrl: true,
      apiKeyPrefix: true,
    },
  });

  const profile = await db.providerProfile.upsert({
    where: { teamId },
    update: data,
    create: { teamId, ...data },
    select: {
      providerName: true,
      website: true,
      contactEmail: true,
      notifyEmail: true,
      notifyWebhook: true,
      webhookUrl: true,
      apiKeyPrefix: true,
    },
  });

  await writeAuditEvent({
    request: req,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.profile.update",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    beforeData: before ?? null,
    // Omit webhookSigningSecret from audit log
    afterData: { ...profile },
  });

  return NextResponse.json(profile);
}
