// ============================================================
//  Clerk Webhook Handler
//  POST /api/webhooks/clerk
//
//  Syncs Clerk identity events to the ArcenPay DB.
//  Verifies the Svix signature before processing.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { slugify } from "@/lib/auth";
import type { TeamRole } from "@/lib/auth";
import { sendWelcomeEmail } from "@/lib/email";


/**
 * Map Clerk's role string to our TeamRole enum.
 * Clerk uses "org:admin", "org:member", etc.
 * Falls back to an explicit dbRole stored in public_metadata (custom override).
 */
function resolveTeamRole(
  clerkRole: string | undefined,
  dbRoleOverride: TeamRole | undefined,
): TeamRole {
  if (dbRoleOverride) return dbRoleOverride;
  switch (clerkRole) {
    case "org:owner":
      return "OWNER";
    case "org:admin":
    case "admin":
      return "ADMIN";
    default:
      return "MEMBER";
  }
}

/**
 * Upsert a user by clerkUserId. If the email already belongs to a different
 * record (P2002 unique violation), update that existing record's clerkUserId
 * so both identities are merged.
 */
async function upsertUserByClerk(
  clerkUserId: string,
  email: string | undefined,
) {
  try {
    return await db.user.upsert({
      where: { clerkUserId },
      create: { clerkUserId, ...(email ? { email } : {}) },
      update: { ...(email ? { email } : {}) },
    });
  } catch (err) {
    // P2002 = unique constraint violation — email belongs to another record
    const prismaErr = err as { code?: string } | null;
    if (prismaErr?.code === "P2002" && email) {
      return await db.user.update({
        where: { email },
        data: { clerkUserId },
      });
    }
    throw err;
  }
}

type ClerkWebhookEvent = {
  type: string;
  data: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const svixId = req.headers.get("svix-id") ?? "";
  const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
  const svixSignature = req.headers.get("svix-signature") ?? "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing svix headers" },
      { status: 400 },
    );
  }

  const payload = await req.text();
  const wh = new Webhook(webhookSecret);

  let event: ClerkWebhookEvent;
  try {
    event = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    console.error("[clerk-webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    await handleEvent(event);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[clerk-webhook] Handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}

async function handleEvent(event: ClerkWebhookEvent) {
  const { type, data } = event;

  switch (type) {
    case "user.created": {
      const clerkUserId = data.id as string;
      const emailAddresses =
        (data.email_addresses as Array<{ email_address: string }>) ?? [];
      const email = emailAddresses[0]?.email_address ?? undefined;
      const firstName = (data.first_name as string) || "";
      const lastName = (data.last_name as string) || "";

      await upsertUserByClerk(clerkUserId, email);

      // Auto-create a personal Clerk organization for every new user.
      // Clerk will fire organization.created + organizationMembership.created
      // which syncs the team + owner membership to the DB automatically.
      try {
        const orgName =
          [firstName, lastName].filter(Boolean).join(" ").trim() ||
          (email ? email.split("@")[0] : null) ||
          "My Workspace";
        const client = await clerkClient();
        await client.organizations.createOrganization({
          name: `${orgName}'s Workspace`,
          createdBy: clerkUserId,
        });
      } catch (err) {
        console.warn("[clerk-webhook] Could not create personal org:", err);
      }

      // Send welcome email (non-blocking)
      if (email) {
        sendWelcomeEmail(email, firstName || undefined).catch((err) => {
          console.warn("[clerk-webhook] Could not send welcome email:", err);
        });
      }
      break;
    }

    case "user.updated": {
      const clerkUserId = data.id as string;
      const emailAddresses =
        (data.email_addresses as Array<{ email_address: string }>) ?? [];
      const email = emailAddresses[0]?.email_address ?? undefined;

      await upsertUserByClerk(clerkUserId, email);
      break;
    }

    case "user.deleted": {
      const clerkUserId = data.id as string;
      if (!clerkUserId) break;
      // Cascade deletes TeamMember + MagicToken via Prisma relations
      await db.user.deleteMany({ where: { clerkUserId } });
      break;
    }

    case "organization.created": {
      const clerkOrgId = data.id as string;
      const name = (data.name as string) || "Workspace";
      let slug = slugify(name);
      const existing = await db.team.findUnique({ where: { slug } });
      if (existing && existing.clerkOrgId !== clerkOrgId) {
        slug = `${slug}-${Date.now()}`;
      }
      await db.team.upsert({
        where: { clerkOrgId },
        create: { name, slug, clerkOrgId },
        update: { name },
      });
      break;
    }

    case "organization.updated": {
      const clerkOrgId = data.id as string;
      const name = (data.name as string) || "Workspace";
      if (!clerkOrgId) break;
      await db.team.updateMany({
        where: { clerkOrgId },
        data: { name },
      });
      break;
    }

    case "organizationMembership.created": {
      const orgId = (data.organization as Record<string, unknown>)
        ?.id as string;
      const memberClerkUserId = (
        data.public_user_data as Record<string, unknown>
      )?.user_id as string;
      const clerkRole = data.role as string | undefined;
      const dbRoleOverride = (data.public_metadata as Record<string, unknown>)
        ?.dbRole as TeamRole | undefined;
      const role = resolveTeamRole(clerkRole, dbRoleOverride);

      if (!orgId || !memberClerkUserId) break;

      const [team, existingUser] = await Promise.all([
        db.team.findUnique({ where: { clerkOrgId: orgId } }),
        db.user.findUnique({ where: { clerkUserId: memberClerkUserId } }),
      ]);

      if (!team) break;

      // Race condition guard: if user.created webhook hasn't been processed yet,
      // create a minimal DB record now so the membership is not lost.
      const user =
        existingUser ?? (await upsertUserByClerk(memberClerkUserId, undefined));

      await db.teamMember.upsert({
        where: { userId_teamId: { userId: user.id, teamId: team.id } },
        create: { userId: user.id, teamId: team.id, role },
        update: { role },
      });

      // Set currentTeamId to the invited org's team if the user doesn't have one.
      // This ensures invited users default to the org they were invited into.
      if (!user.currentTeamId) {
        await db.user.update({
          where: { id: user.id },
          data: { currentTeamId: team.id },
        });
      }
      break;
    }

    case "organizationMembership.updated": {
      const orgId = (data.organization as Record<string, unknown>)
        ?.id as string;
      const memberClerkUserId = (
        data.public_user_data as Record<string, unknown>
      )?.user_id as string;
      const clerkRole = data.role as string | undefined;
      const dbRoleOverride = (data.public_metadata as Record<string, unknown>)
        ?.dbRole as TeamRole | undefined;
      const role = resolveTeamRole(clerkRole, dbRoleOverride);

      if (!orgId || !memberClerkUserId) break;

      const [team, user] = await Promise.all([
        db.team.findUnique({ where: { clerkOrgId: orgId } }),
        db.user.findUnique({ where: { clerkUserId: memberClerkUserId } }),
      ]);

      if (!team || !user) break;

      await db.teamMember.updateMany({
        where: { userId: user.id, teamId: team.id },
        data: { role },
      });
      break;
    }

    case "organizationMembership.deleted": {
      const orgId = (data.organization as Record<string, unknown>)
        ?.id as string;
      const memberClerkUserId = (
        data.public_user_data as Record<string, unknown>
      )?.user_id as string;

      if (!orgId || !memberClerkUserId) break;

      const [team, user] = await Promise.all([
        db.team.findUnique({ where: { clerkOrgId: orgId } }),
        db.user.findUnique({ where: { clerkUserId: memberClerkUserId } }),
      ]);

      if (!team || !user) break;

      await db.teamMember.deleteMany({
        where: { userId: user.id, teamId: team.id },
      });
      break;
    }

    default:
      // Ignore unhandled event types
      break;
  }
}
