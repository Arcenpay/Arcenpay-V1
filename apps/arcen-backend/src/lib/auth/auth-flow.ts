import { randomBytes, randomInt } from "node:crypto";
import { db } from "../../db.js";
import { hashOpaqueToken } from "./auth.server.js";
import { slugify, type TeamRole } from "./auth.js";
import {
  isEmailDeliveryConfigured,
  sendEmailAuthCode,
  sendTeamInviteEmail,
} from "../billing/email.js";
export const EMAIL_AUTH_PURPOSE_LOGIN = "login";
export const EMAIL_AUTH_CODE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_AUTH_RESEND_COOLDOWN_MS = 30 * 1000;
export const EMAIL_AUTH_MAX_ATTEMPTS = 5;
export const TEAM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeWalletAddress(address: string): string {
  // Stellar addresses (G…/C… account IDs) are case-sensitive base32 —
  // lowercasing them corrupts the address and breaks DB lookups. Only
  // EVM (0x-prefixed hex) addresses are case-insensitive and need
  // lowercasing for consistent storage.
  if (address.startsWith("0x") || address.startsWith("0X")) {
    return address.toLowerCase();
  }
  return address;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 1, 4))}@${domain}`;
}

export async function findWalletConflict(
  walletAddress: string,
  attemptEmail: string,
): Promise<{ conflict: true; ownerEmail: string; maskedEmail: string } | { conflict: false }> {
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  const normalizedAttemptEmail = normalizeEmail(attemptEmail);

  // Stellar addresses (G…) live in stellarWalletAddress; EVM addresses (0x…) in walletAddress.
  const isStellar = normalizedWallet.startsWith("G");
  const where = isStellar
    ? { stellarWalletAddress: normalizedWallet }
    : { walletAddress: normalizedWallet };

  const walletOwner = await db.user.findUnique({
    where,
    select: { id: true, email: true },
  });

  if (!walletOwner) {
    return { conflict: false };
  }

  const ownerEmail = normalizeEmail(walletOwner.email ?? "");
  if (ownerEmail === normalizedAttemptEmail) {
    return { conflict: false };
  }

  return {
    conflict: true,
    ownerEmail: walletOwner.email ?? "",
    maskedEmail: maskEmail(walletOwner.email ?? ""),
  };
}

export async function findEmailWalletConflict(
  email: string,
  attemptWalletAddress?: string,
): Promise<{ conflict: true; ownerWallet: string } | { conflict: false }> {
  const normalizedEmail = normalizeEmail(email);

  const emailOwner = await db.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, walletAddress: true, stellarWalletAddress: true },
  });

  if (!emailOwner) {
    return { conflict: false };
  }

  // The email owner already has a wallet linked. Check if the attempted
  // wallet matches ANY of the owner's wallets.
  const ownerWallets = [
    emailOwner.walletAddress,
    emailOwner.stellarWalletAddress,
  ].filter(Boolean) as string[];

  if (ownerWallets.length === 0) {
    return { conflict: false };
  }

  if (!attemptWalletAddress) {
    return { conflict: false };
  }

  const normalizedAttemptWallet = normalizeWalletAddress(attemptWalletAddress);
  const isSameWallet = ownerWallets.some(
    (w) => normalizeWalletAddress(w) === normalizedAttemptWallet,
  );

  if (isSameWallet) {
    return { conflict: false };
  }

  // Report the first linked wallet for error messaging
  return {
    conflict: true,
    ownerWallet: ownerWallets[0],
  };
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

async function uniqueTeamSlug(base: string): Promise<string> {
  let slug = slugify(base) || "workspace";
  let suffix = 0;

  while (await db.team.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${slugify(base) || "workspace"}-${suffix}`;
  }

  return slug;
}

function buildWorkspaceName(email: string): string {
  const local = email.split("@")[0]?.trim();
  if (!local) return "My Workspace";
  return `${local}'s Workspace`;
}

export async function issueEmailAuthCode(input: {
  email: string;
  purpose?: string;
  userId?: string | null;
}): Promise<{ code: string; expiresAt: Date; retryAt: Date }> {
  const email = normalizeEmail(input.email);
  const purpose = input.purpose ?? EMAIL_AUTH_PURPOSE_LOGIN;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_AUTH_CODE_TTL_MS);
  const retryAt = new Date(now.getTime() + EMAIL_AUTH_RESEND_COOLDOWN_MS);
  const code = generateCode();

  const previousActive = await db.emailAuthCode.findMany({
    where: {
      email,
      purpose,
      usedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });

  const created = await db.$transaction(async (tx) => {
    if (previousActive.length > 0) {
      await tx.emailAuthCode.updateMany({
        where: { id: { in: previousActive.map((record) => record.id) } },
        data: { usedAt: now },
      });
    }

    return tx.emailAuthCode.create({
      data: {
        email,
        purpose,
        codeHash: hashOpaqueToken(`${purpose}:${email}:${code}`),
        expiresAt,
        userId: input.userId ?? undefined,
      },
    });
  });

  try {
    if (!isEmailDeliveryConfigured() && process.env.NODE_ENV !== "production") {
      console.warn(
        "[auth-flow] Skipping email auth delivery because Resend is not configured in development.",
      );
    } else {
      await sendEmailAuthCode(email, code);
    }
  } catch (error) {
    await db.$transaction(async (tx) => {
      await tx.emailAuthCode.deleteMany({
        where: { id: created.id },
      });

      if (previousActive.length > 0) {
        await tx.emailAuthCode.updateMany({
          where: { id: { in: previousActive.map((record) => record.id) } },
          data: { usedAt: null },
        });
      }
    });
    throw error;
  }

  return { code, expiresAt, retryAt };
}

export async function getLatestActiveEmailCode(
  email: string,
  purpose = EMAIL_AUTH_PURPOSE_LOGIN,
) {
  return db.emailAuthCode.findFirst({
    where: {
      email: normalizeEmail(email),
      purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function verifyEmailAuthCode(input: {
  email: string;
  code: string;
  purpose?: string;
}) {
  const email = normalizeEmail(input.email);
  const purpose = input.purpose ?? EMAIL_AUTH_PURPOSE_LOGIN;
  const record = await getLatestActiveEmailCode(email, purpose);

  if (!record) {
    return { ok: false as const, reason: "missing" as const };
  }

  if (record.attemptCount >= EMAIL_AUTH_MAX_ATTEMPTS) {
    return { ok: false as const, reason: "too_many_attempts" as const };
  }

  const expectedHash = hashOpaqueToken(`${purpose}:${email}:${input.code}`);
  if (record.codeHash !== expectedHash) {
    await db.emailAuthCode.update({
      where: { id: record.id },
      data: { attemptCount: { increment: 1 } },
    });
    return { ok: false as const, reason: "invalid" as const };
  }

  await db.emailAuthCode.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return { ok: true as const, record };
}

export async function provisionUserForEmail(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.currentTeamId) {
      const membership = await db.teamMember.findFirst({
        where: { userId: existing.id },
        orderBy: { createdAt: "asc" },
      });
      if (membership) {
        await db.user.update({
          where: { id: existing.id },
          data: { currentTeamId: membership.teamId, emailVerified: true },
        });
        return db.user.findUniqueOrThrow({ where: { id: existing.id } });
      }
    }

    if (!existing.emailVerified) {
      await db.user.update({
        where: { id: existing.id },
        data: { emailVerified: true },
      });
      return db.user.findUniqueOrThrow({ where: { id: existing.id } });
    }

    return existing;
  }

  const workspaceName = buildWorkspaceName(email);
  const slug = await uniqueTeamSlug(workspaceName);

  const created = await db.user.create({
    data: {
      email,
      emailVerified: true,
      teams: {
        create: {
          role: "OWNER",
          team: {
            create: {
              name: workspaceName,
              slug,
              providerProfiles: {
                create: {
                  contactEmail: email,
                },
              },
            },
          },
        },
      },
    },
    include: {
      teams: {
        include: {
          team: true,
        },
      },
    },
  });

  const firstTeamId = created.teams[0]?.teamId;
  if (firstTeamId) {
    await db.user.update({
      where: { id: created.id },
      data: { currentTeamId: firstTeamId },
    });

    // Do not create an environment during account creation. The owner must
    // explicitly choose the first environment and chain in onboarding. The
    // environment creation route then creates its catalog config, copies the
    // team profile, provisions the single FREE first-party subscription, and
    // marks that user-created environment as the workspace default.
  }

  return db.user.findUniqueOrThrow({ where: { id: created.id } });
}

export async function createTeamInvitation(input: {
  teamId: string;
  email: string;
  role: TeamRole;
  invitedByUserId?: string | null;
  inviterEmail?: string | null;
}) {
  const email = normalizeEmail(input.email);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + TEAM_INVITE_TTL_MS);

  const team = await db.team.findUnique({
    where: { id: input.teamId },
    select: { name: true },
  });

  if (!team) {
    throw new Error(`Team ${input.teamId} not found`);
  }

  await db.teamInvitation.create({
    data: {
      teamId: input.teamId,
      email,
      role: input.role,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
      invitedByUserId: input.invitedByUserId ?? undefined,
    },
  });

  await sendTeamInviteEmail(
    email,
    token,
    team.name,
    input.inviterEmail ?? null,
  );

  return { token, expiresAt };
}

export async function getActiveTeamInvitationByToken(token: string) {
  return db.teamInvitation.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    include: {
      team: { select: { id: true, name: true, slug: true } },
    },
  });
}

export async function acceptTeamInvitation(userId: string, token: string) {
  const invitation = await getActiveTeamInvitationByToken(token);
  if (!invitation) {
    return { ok: false as const, reason: "missing" as const };
  }

  const now = new Date();
  if (invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= now) {
    return { ok: false as const, reason: "expired" as const };
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });

  if (!user || !user.email || normalizeEmail(user.email) !== invitation.email) {
    return { ok: false as const, reason: "email_mismatch" as const };
  }

  await db.$transaction([
    db.teamMember.upsert({
      where: {
        userId_teamId: {
          userId,
          teamId: invitation.teamId,
        },
      },
      create: {
        userId,
        teamId: invitation.teamId,
        role: invitation.role,
      },
      update: {
        role: invitation.role,
      },
    }),
    db.user.update({
      where: { id: userId },
      data: { currentTeamId: invitation.teamId },
    }),
    db.teamInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: now },
    }),
  ]);

  return {
    ok: true as const,
    invitation,
  };
}
