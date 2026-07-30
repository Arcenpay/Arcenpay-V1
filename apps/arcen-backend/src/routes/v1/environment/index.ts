import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import {
  canManageEnvironment,
  isChainAllowedForMode,
  listEnvironmentSummaries,
  toEnvironmentSummary,
} from "../../../lib/environments/workspace-environments.js";
import { isErrorResponse, requireTeamRoles } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { getTierLimits } from "../../../lib/catalog/tier-guard.js";
import { sendWelcomeEmail } from "../../../lib/billing/email.js";

const manageRoles = ["OWNER", "ADMIN"] as const;

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
  mode: z.enum(["DEVELOPMENT", "PRODUCTION"]),
  chainId: z.coerce.number().int().positive(),
});

const selectSchema = z.object({
  environmentId: z.string().min(1),
});

const renameSchema = z.object({
  environmentId: z.string().min(1),
  name: z.string().trim().min(1).max(64),
});

async function listEnvironments(c: Context) {
  const auth = await requireTeamRoles(c, [
    "OWNER",
    "ADMIN",
    "FINANCE",
    "DEVELOPER",
    "SUPPORT",
    "MEMBER",
  ]);
  if (isErrorResponse(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  const team = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { platformTier: true },
  });
  if (!team) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  const [limits, environments] = await Promise.all([
    getTierLimits(team.platformTier),
    listEnvironmentSummaries(auth.team.teamId, auth.session.activeEnvironmentId),
  ]);

  return c.json({
    environments,
    limits: {
      development: limits.maxDevelopmentEnvironments,
      production: limits.maxProductionEnvironments,
    },
    counts: {
      development: environments.filter((env) => env.mode === "DEVELOPMENT").length,
      production: environments.filter((env) => env.mode === "PRODUCTION").length,
    },
  });
}

async function createEnvironment(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400 as any,
    );
  }

  if (!isChainAllowedForMode(parsed.data.mode, parsed.data.chainId)) {
    return c.json({ error: "Selected chain is not allowed for this environment type." }, 400 as any);
  }

  const team = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { platformTier: true },
  });
  if (!team) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  const [limits, existingCount, existingName] = await Promise.all([
    getTierLimits(team.platformTier),
    db.workspaceEnvironment.count({
      where: { teamId: auth.team.teamId, mode: parsed.data.mode },
    }),
    db.workspaceEnvironment.findFirst({
      where: {
        teamId: auth.team.teamId,
        name: parsed.data.name,
      },
    }),
  ]);

  if (existingName) {
    // If the environment with this name already exists for the team, select it as active!
    await db.authSession.update({
      where: { id: auth.session.sessionId },
      data: { activeEnvironmentId: existingName.id },
    });

    // Copy onboarding profile if missing
    try {
      const existingProfile = await db.providerProfile.findUnique({
        where: {
          teamId_environmentId: {
            teamId: auth.team.teamId,
            environmentId: existingName.id,
          },
        },
      });

      if (!existingProfile) {
        const teamRecord = await db.team.findUnique({
          where: { id: auth.team.teamId },
          select: { profileData: true },
        });
        const raw = teamRecord?.profileData;
        const profileData = raw && typeof raw === "object" && !Array.isArray(raw)
          ? raw as Record<string, unknown>
          : null;

        if (profileData && (profileData.providerName || profileData.contactEmail)) {
          await db.providerProfile.create({
            data: {
              teamId: auth.team.teamId,
              environmentId: existingName.id,
              providerName: typeof profileData.providerName === "string" ? profileData.providerName : null,
              website: typeof profileData.website === "string" ? profileData.website : null,
              contactEmail: typeof profileData.contactEmail === "string" ? profileData.contactEmail : null,
              legalName: typeof profileData.legalName === "string" ? profileData.legalName : null,
              billingEmail: typeof profileData.billingEmail === "string" ? profileData.billingEmail : null,
              supportEmail: typeof profileData.supportEmail === "string" ? profileData.supportEmail : null,
              supportPhone: typeof profileData.supportPhone === "string" ? profileData.supportPhone : null,
              supportUrl: typeof profileData.supportUrl === "string" ? profileData.supportUrl : null,
              addressLine1: typeof profileData.addressLine1 === "string" ? profileData.addressLine1 : null,
              addressLine2: typeof profileData.addressLine2 === "string" ? profileData.addressLine2 : null,
              city: typeof profileData.city === "string" ? profileData.city : null,
              state: typeof profileData.state === "string" ? profileData.state : null,
              postalCode: typeof profileData.postalCode === "string" ? profileData.postalCode : null,
              country: typeof profileData.country === "string" ? profileData.country : null,
              taxId: typeof profileData.taxId === "string" ? profileData.taxId : null,
              gstin: typeof profileData.gstin === "string" ? profileData.gstin : null,
            },
          });
        }
      }
    } catch (profileErr) {
      console.error("Failed to copy provider profile for existing environment:", profileErr);
    }

    return c.json(
      {
        environment: toEnvironmentSummary(existingName, existingName.id),
        message: "Environment already exists; activated successfully.",
      },
      200 as any,
    );
  }

  const usedChains = await db.workspaceEnvironment.findMany({
    where: { teamId: auth.team.teamId },
    select: { chainId: true },
    distinct: ["chainId"],
  });
  const isNewChain = !usedChains.some((e) => e.chainId === parsed.data.chainId);
  if (isNewChain && usedChains.length >= limits.maxChains) {
    return c.json(
      {
        error: `Chain limit reached. Your plan supports up to ${limits.maxChains} chain(s).`,
        limit: limits.maxChains,
        current: usedChains.length,
      },
      409 as any,
    );
  }

  const limit =
    parsed.data.mode === "DEVELOPMENT"
      ? limits.maxDevelopmentEnvironments
      : limits.maxProductionEnvironments;

  if (existingCount >= limit) {
    return c.json(
      {
        error: `Environment limit reached for ${parsed.data.mode.toLowerCase()}.`,
        limit,
        current: existingCount,
      },
      409 as any,
    );
  }

  const environment = await db.workspaceEnvironment.create({
    data: {
      teamId: auth.team.teamId,
      name: parsed.data.name,
      mode: parsed.data.mode,
      chainId: parsed.data.chainId,
    },
  });

  await db.authSession.update({
    where: { id: auth.session.sessionId },
    data: { activeEnvironmentId: environment.id },
  });

  await db.catalogConfig.create({
    data: {
      teamId: auth.team.teamId,
      environmentId: environment.id,
      environmentMode: environment.mode,
    },
  }).catch(() => {});

  // Copy onboarding profile from team record to the new environment's ProviderProfile
  try {
    const teamRecord = await db.team.findUnique({
      where: { id: auth.team.teamId },
      select: { profileData: true },
    });
    const raw = teamRecord?.profileData;
    const profileData = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : null;

    if (profileData && (profileData.providerName || profileData.contactEmail)) {
      await db.providerProfile.create({
        data: {
          teamId: auth.team.teamId,
          environmentId: environment.id,
          providerName: typeof profileData.providerName === "string" ? profileData.providerName : null,
          website: typeof profileData.website === "string" ? profileData.website : null,
          contactEmail: typeof profileData.contactEmail === "string" ? profileData.contactEmail : null,
          legalName: typeof profileData.legalName === "string" ? profileData.legalName : null,
          billingEmail: typeof profileData.billingEmail === "string" ? profileData.billingEmail : null,
          supportEmail: typeof profileData.supportEmail === "string" ? profileData.supportEmail : null,
          supportPhone: typeof profileData.supportPhone === "string" ? profileData.supportPhone : null,
          supportUrl: typeof profileData.supportUrl === "string" ? profileData.supportUrl : null,
          addressLine1: typeof profileData.addressLine1 === "string" ? profileData.addressLine1 : null,
          addressLine2: typeof profileData.addressLine2 === "string" ? profileData.addressLine2 : null,
          city: typeof profileData.city === "string" ? profileData.city : null,
          state: typeof profileData.state === "string" ? profileData.state : null,
          postalCode: typeof profileData.postalCode === "string" ? profileData.postalCode : null,
          country: typeof profileData.country === "string" ? profileData.country : null,
          taxId: typeof profileData.taxId === "string" ? profileData.taxId : null,
          gstin: typeof profileData.gstin === "string" ? profileData.gstin : null,
        },
      });
    }
  } catch (profileErr) {
    console.error("Failed to copy provider profile on environment creation:", profileErr);
  }

  // Send welcome email on first environment creation (onboarding complete)
  try {
    const totalEnvironments = await db.workspaceEnvironment.count({
      where: { teamId: auth.team.teamId },
    });
    if (totalEnvironments === 1) {
      const user = await db.user.findUnique({
        where: { id: auth.team.userId },
        select: { email: true },
      });
      if (user?.email) {
        sendWelcomeEmail(user.email).catch((error) => {
          console.warn("[environment] Could not send welcome email:", error);
        });
      }
    }
  } catch {
    // Non-blocking: welcome email failures must not prevent environment creation
  }

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "environment.create",
    resourceType: "WorkspaceEnvironment",
    resourceId: environment.id,
    afterData: environment,
  });

  return c.json(
    {
      environment: toEnvironmentSummary(environment, environment.id),
    },
    201 as any,
  );
}

async function selectEnvironment(c: Context) {
  const auth = await requireTeamRoles(c, [
    "OWNER",
    "ADMIN",
    "FINANCE",
    "DEVELOPER",
    "SUPPORT",
    "MEMBER",
  ]);
  if (isErrorResponse(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  const parsed = selectSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400 as any,
    );
  }

  const environment = await db.workspaceEnvironment.findFirst({
    where: {
      id: parsed.data.environmentId,
      teamId: auth.team.teamId,
    },
  });
  if (!environment) {
    return c.json({ error: "Environment not found" }, 404 as any);
  }

  await db.authSession.update({
    where: { id: auth.session.sessionId },
    data: { activeEnvironmentId: environment.id },
  });

  return c.json({
    environment: toEnvironmentSummary(environment, environment.id),
  });
}

async function renameEnvironment(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  const parsed = renameSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400 as any,
    );
  }

  const existing = await db.workspaceEnvironment.findFirst({
    where: {
      id: parsed.data.environmentId,
      teamId: auth.team.teamId,
    },
  });
  if (!existing) {
    return c.json({ error: "Environment not found" }, 404 as any);
  }

  const conflict = await db.workspaceEnvironment.findFirst({
    where: {
      teamId: auth.team.teamId,
      name: parsed.data.name,
      id: { not: existing.id },
    },
    select: { id: true },
  });
  if (conflict) {
    return c.json({ error: "An environment with this name already exists." }, 409 as any);
  }

  const updated = await db.workspaceEnvironment.update({
    where: { id: existing.id },
    data: { name: parsed.data.name },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "environment.rename",
    resourceType: "WorkspaceEnvironment",
    resourceId: updated.id,
    beforeData: existing,
    afterData: updated,
  });

  return c.json({
    environment: toEnvironmentSummary(updated, auth.session.activeEnvironmentId),
  });
}

async function deprecatedSwitch(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  return c.json(
    {
      error:
        "Environment mode switching has been removed. Create or select a workspace environment instead.",
    },
    410 as any,
  );
}

export const environmentRoutes = new Hono()
  .get("/", listEnvironments)
  .post("/", createEnvironment)
  .post("/select", selectEnvironment)
  .patch("/", renameEnvironment)
  .post("/switch", deprecatedSwitch);
