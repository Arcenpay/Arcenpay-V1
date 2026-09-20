import type { Context } from "hono";
import { z } from "zod";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "../../../config.js";
import { db } from "../../../db.js";
import { upsertScopedSubscriberEmail } from "../../../lib/billing/subscriber-emails.js";
import { resolveSession } from "../../../middleware/auth.js";
import { normalizeApiKeyAuth, hashApiKey } from "../../../lib/auth/api-key-auth.js";
import { normalizeWallet } from "../../../lib/billing/utils.js";

const EmailSchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid wallet address"),
  email: z.string().email("Invalid email address"),
  planId: z.string().optional(),
});

/**
 * Proves the caller is entitled to manage the notification email for
 * `walletAddress`.
 *
 * SECURITY: this endpoint previously accepted any wallet address from any
 * anonymous caller and wrote it to the customer-email registry. That let an
 * attacker point another subscriber's invoices, receipts and dunning notices at
 * an address they control (billing-PII disclosure and notification hijack)
 * knowing nothing but a public wallet address.
 *
 * Entitlement is established by one of:
 *   1. A dashboard session whose own wallet (EVM or Stellar) is the address, OR
 *   2. A team-scoped API key for a team that owns a company at that wallet.
 */
async function canManageWalletEmail(
  c: Context,
  walletAddress: string,
): Promise<boolean> {
  const session = await resolveSession(c);
  if (session) {
    const sessionWallets = [
      normalizeWallet(session.walletAddress),
      normalizeWallet(session.stellarWalletAddress),
    ].filter(Boolean);
    if (sessionWallets.includes(normalizeWallet(walletAddress))) return true;

    // Fall through: a logged-in provider may also manage a customer wallet
    // that belongs to their own workspace.
    if (session.currentTeamId) {
      const company = await db.arcenCompany.findFirst({
        where: {
          teamId: session.currentTeamId,
          walletAddress: { equals: walletAddress, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (company) return true;
    }
    return false;
  }

  // API-key path: the key's team must own a company at this wallet.
  const raw = normalizeApiKeyAuth(
    c.req.header("authorization") ?? c.req.header("x-api-key"),
  );
  if (!raw) return false;

  const apiKey = await db.arcenApiKey.findUnique({
    where: { keyHash: hashApiKey(raw) },
    select: { id: true, teamId: true, revokedAt: true, expiresAt: true },
  });
  if (!apiKey || apiKey.revokedAt) return false;
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) return false;

  const company = await db.arcenCompany.findFirst({
    where: {
      teamId: apiKey.teamId,
      walletAddress: { equals: walletAddress, mode: "insensitive" },
    },
    select: { id: true },
  });
  return Boolean(company);
}

export async function registerEmail(c: Context) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = EmailSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
          error: "Invalid request",
          details: parsed.error.flatten().fieldErrors,
        }, 400 as any);
    }

    const { walletAddress, email, planId } = parsed.data;

    if (!(await canManageWalletEmail(c, walletAddress))) {
      return c.json({ error: "Unauthorized" }, 401 as any);
    }

    await upsertScopedSubscriberEmail({
      walletAddress,
      email,
      planId: planId ?? null,
    });

    fetch(`${FACILITATOR_URL}/api/subscriber/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(FACILITATOR_SECRET
          ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
          : {}),
      },
      body: JSON.stringify({ walletAddress, email, planId }),
    }).catch(() => {
      // Non-fatal — DB record is the source of truth
    });

    return c.json({ ok: true });
  } catch (err) {
    console.error("[subscriber/email]", err);
    return c.json({ error: "Internal server error" }, 500 as any);
  }
}
