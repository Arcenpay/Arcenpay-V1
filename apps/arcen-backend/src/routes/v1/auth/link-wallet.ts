import type { Context } from "hono";
import { verifyMessage } from "viem";
import { z } from "zod";
import { db } from "../../../db.js";
import { buildSIWEMessage } from "../../../lib/auth/auth.js";
import { consumeNonce } from "../../../lib/auth/nonce.server.js";
import { getSessionFromCtx } from "../../../lib/auth/auth.server.js";
import { maskEmail } from "../../../lib/auth/auth-flow.js";
import { isSupportedDashboardChainId, getChainLabel, TESTNET_CHAIN_IDS } from "../../../lib/platform/default-chain.js";

const Schema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.number().int().positive(),
  nonce: z.string().min(1),
});

export async function linkWallet(c: Context) {
  try {
    const session = await getSessionFromCtx(c);
    if (!session) {
      return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return c.json({
          ok: false,
          error: "Invalid request",
          code: "BAD_REQUEST",
          details: parsed.error.flatten().fieldErrors,
        }, 400 as any);
    }

    const { message, signature, address, chainId, nonce } = parsed.data;
    const normalizedAddress = address.toLowerCase();

    if (!isSupportedDashboardChainId(chainId)) {
      const labels = TESTNET_CHAIN_IDS.map(getChainLabel).join(" or ");
      return c.json({
          ok: false,
          error: `Unsupported network. Connect to ${labels} to link your wallet.`,
          code: "BAD_REQUEST",
        }, 400 as any);
    }

    const nonceRecord = await consumeNonce(nonce);
    if (!nonceRecord) {
      return c.json({ ok: false, error: "Invalid or expired nonce", code: "UNAUTHORIZED" }, 401 as any);
    }

    const host =
      c.req.header("x-forwarded-host") || c.req.header("host") || "arcenpay.xyz";
    const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
    const proto =
      c.req.header("x-forwarded-proto") || (isLocal ? "http" : "https");
    const expectedMessage = buildSIWEMessage({
      address,
      chainId,
      nonce,
      domain: host,
      uri: `${proto}://${host}`,
      issuedAt: nonceRecord.issuedAt,
    });

    if (message !== expectedMessage) {
      return c.json({ ok: false, error: "SIWE message mismatch", code: "UNAUTHORIZED" }, 401 as any);
    }

    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message: expectedMessage,
      signature: signature as `0x${string}`,
    });
    if (!isValid) {
      return c.json({ ok: false, error: "Invalid signature", code: "UNAUTHORIZED" }, 401 as any);
    }

    const walletOwner = await db.user.findUnique({
      where: { walletAddress: normalizedAddress },
      select: { id: true, email: true },
    });

    if (walletOwner && walletOwner.id !== session.userId) {
      return c.json({
          ok: false,
          error: "This wallet is already linked to another account",
          code: "CONFLICT",
          maskedOwnerEmail: maskEmail(walletOwner.email ?? ""),
        }, 409 as any);
    }

    await db.user.update({
      where: { id: session.userId },
      data: {
        walletAddress: normalizedAddress,
      },
    });

    return c.json({ ok: true, address: normalizedAddress });
  } catch (err) {
    console.error("[api/auth/link-wallet]", err);
    return c.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, 500 as any);
  }
}
