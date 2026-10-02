import type { Context } from "hono";
import { verifyMessage } from "viem";
import { z } from "zod";
import { db } from "../../../db.js";
import { buildSIWEMessage } from "../../../lib/auth/auth.js";
import { consumeNonce } from "../../../lib/auth/nonce.server.js";
import { getSessionFromCtx } from "../../../lib/auth/auth.server.js";
import { maskEmail } from "../../../lib/auth/auth-flow.js";
import {
  isSupportedDashboardChainId,
  isSupportedWalletAuthChainId,
  getChainLabel,
  TESTNET_CHAIN_IDS,
  MAINNET_CHAIN_IDS,
} from "../../../lib/platform/default-chain.js";
import { getChainFamily } from "@arcenpay/internal-core";

const Schema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  address: z.string().min(1),
  chainId: z.number().int().positive(),
  nonce: z.string().min(1),
});

function isStellarChainId(chainId: number) {
  return getChainFamily(chainId) === "stellar";
}

function isSolanaChainId(chainId: number) {
  return getChainFamily(chainId) === "solana";
}

function requestOrigin(c: Context): { host: string; protocol: string } {
  const origin = c.req.header("origin");
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      const hostname = parsedOrigin.hostname.toLowerCase();
      const isTrustedOrigin =
        hostname === "arcenpay.com" ||
        hostname.endsWith(".arcenpay.com") ||
        hostname === "localhost" ||
        hostname === "127.0.0.1";
      if (isTrustedOrigin) {
        return {
          host: parsedOrigin.host,
          protocol: parsedOrigin.protocol.slice(0, -1),
        };
      }
    } catch {
      // Fall through to the request host for malformed origins.
    }
  }

  const forwardedHost = c.req.header("x-forwarded-host");
  const forwardedProto = c.req.header("x-forwarded-proto");
  if (forwardedHost) {
    return {
      host: forwardedHost.split(",", 1)[0].trim(),
      protocol: forwardedProto?.split(",", 1)[0].trim() || "https",
    };
  }

  return {
    host: c.req.header("host") || "arcenpay.com",
    protocol: "https",
  };
}

export async function linkWallet(c: Context) {
  try {
    const session = await getSessionFromCtx(c);
    if (!session) {
      return c.json(
        { ok: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        401 as any,
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          error: "Invalid request",
          code: "BAD_REQUEST",
          details: parsed.error.flatten().fieldErrors,
        },
        400 as any,
      );
    }

    const { message, signature, address, chainId, nonce } = parsed.data;
    const isStellar = isStellarChainId(chainId);
    const isSolana = isSolanaChainId(chainId);
    // Stellar (G…/C…) and Solana (base58) addresses are case-sensitive.
    const normalizedAddress = isStellar || isSolana ? address : address.toLowerCase();

    // Support EVM chains, Stellar and Solana synthetic chain IDs (9_000_000+/9_100_000+)
    if (!isSupportedWalletAuthChainId(chainId) && !isStellarChainId(chainId) && !isSolanaChainId(chainId)) {
      const labels = [...TESTNET_CHAIN_IDS, ...MAINNET_CHAIN_IDS].map(getChainLabel).join(" or ");
      return c.json(
        {
          ok: false,
          error: `Unsupported network. Connect to ${labels} to link your wallet.`,
          code: "BAD_REQUEST",
        },
        400 as any,
      );
    }

    const nonceRecord = await consumeNonce(nonce);
    if (!nonceRecord) {
      return c.json(
        { ok: false, error: "Invalid or expired nonce", code: "UNAUTHORIZED" },
        401 as any,
      );
    }

    // ── Stellar path ──────────────────────────────────────────────────────
    if (isStellarChainId(chainId)) {
      // Stellar signature: a base64-encoded ed25519 signature produced by
      // StellarWalletsKit/Freighter's `signMessage` over the exact message
      // text below. We reconstruct the expected message and verify the
      // signature cryptographically (Keypair.verify).
      //
      // Reconstruct expected message from the same format the frontend builds:
      //   `ArcenPay Stellar Sign-In\n\nAddress: ${addr}\nNonce: ${n}\nIssued At: ${d}\nDomain: ${host}`
      const { host } = requestOrigin(c);
      const expectedMessage = `ArcenPay Stellar Sign-In\n\nAddress: ${normalizedAddress}\nNonce: ${nonce}\nIssued At: ${nonceRecord.issuedAt}\nDomain: ${host}`;

      if (message !== expectedMessage) {
        return c.json(
          { ok: false, error: "Message mismatch", code: "UNAUTHORIZED" },
          401 as any,
        );
      }

      const { Keypair } = await import("@stellar/stellar-sdk");
      let signatureValid = false;
      try {
        signatureValid = Keypair.fromPublicKey(normalizedAddress).verify(
          Buffer.from(expectedMessage, "utf8"),
          Buffer.from(signature, "base64"),
        );
      } catch {
        signatureValid = false;
      }
      if (!signatureValid) {
        return c.json(
          { ok: false, error: "Invalid signature", code: "UNAUTHORIZED" },
          401 as any,
        );
      }

      const walletOwner = await db.user.findUnique({
        where: isStellar
          ? { stellarWalletAddress: normalizedAddress }
          : { walletAddress: normalizedAddress },
        select: { id: true, email: true },
      });

      if (walletOwner && walletOwner.id !== session.userId) {
        return c.json(
          {
            ok: false,
            error: "This wallet is already linked to another account",
            code: "CONFLICT",
            maskedOwnerEmail: maskEmail(walletOwner.email ?? ""),
          },
          409 as any,
        );
      }

      await db.user.update({
        where: { id: session.userId },
        data: isStellar
          ? { stellarWalletAddress: normalizedAddress }
          : { walletAddress: normalizedAddress },
      });

      return c.json({ ok: true, address: normalizedAddress });
    }

    // ── Solana path ───────────────────────────────────────────────────────
    if (isSolana) {
      // Solana wallets (`signMessage`) produce a base58 ed25519 signature over
      // the raw UTF-8 message below. We rebuild the expected message and verify
      // it with tweetnacl (see solana-signature.ts).
      const { host } = requestOrigin(c);
      const expectedMessage = `ArcenPay Solana Sign-In\n\nAddress: ${normalizedAddress}\nNonce: ${nonce}\nIssued At: ${nonceRecord.issuedAt}\nDomain: ${host}`;

      if (message !== expectedMessage) {
        return c.json(
          { ok: false, error: "Message mismatch", code: "UNAUTHORIZED" },
          401 as any,
        );
      }

      const { verifySolanaSignature, isValidSolanaAddress } = await import(
        "../../../lib/payments/solana-signature.js"
      );
      if (!isValidSolanaAddress(normalizedAddress)) {
        return c.json(
          { ok: false, error: "Invalid Solana address", code: "BAD_REQUEST" },
          400 as any,
        );
      }
      const signatureValid = verifySolanaSignature({
        message: expectedMessage,
        signatureBase58: signature,
        address: normalizedAddress,
      });
      if (!signatureValid) {
        return c.json(
          { ok: false, error: "Invalid signature", code: "UNAUTHORIZED" },
          401 as any,
        );
      }

      const walletOwner = await db.user.findUnique({
        where: { solanaWalletAddress: normalizedAddress },
        select: { id: true, email: true },
      });

      if (walletOwner && walletOwner.id !== session.userId) {
        return c.json(
          {
            ok: false,
            error: "This wallet is already linked to another account",
            code: "CONFLICT",
            maskedOwnerEmail: maskEmail(walletOwner.email ?? ""),
          },
          409 as any,
        );
      }

      await db.user.update({
        where: { id: session.userId },
        data: { solanaWalletAddress: normalizedAddress },
      });

      return c.json({ ok: true, address: normalizedAddress });
    }

    // ── EVM path (SIWE) ───────────────────────────────────────────────────
    const { host, protocol: proto } = requestOrigin(c);
    const expectedMessage = buildSIWEMessage({
      address,
      chainId,
      nonce,
      domain: host,
      uri: `${proto}://${host}`,
      issuedAt: nonceRecord.issuedAt,
    });

    if (message !== expectedMessage) {
      return c.json(
        { ok: false, error: "SIWE message mismatch", code: "UNAUTHORIZED" },
        401 as any,
      );
    }

    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message: expectedMessage,
      signature: signature as `0x${string}`,
    });
    if (!isValid) {
      return c.json(
        { ok: false, error: "Invalid signature", code: "UNAUTHORIZED" },
        401 as any,
      );
    }

    const walletOwner = await db.user.findUnique({
      where: { walletAddress: normalizedAddress },
      select: { id: true, email: true },
    });

    if (walletOwner && walletOwner.id !== session.userId) {
      return c.json(
        {
          ok: false,
          error: "This wallet is already linked to another account",
          code: "CONFLICT",
          maskedOwnerEmail: maskEmail(walletOwner.email ?? ""),
        },
        409 as any,
      );
    }

    await db.user.update({
      where: { id: session.userId },
      data: { walletAddress: normalizedAddress },
    });

    return c.json({ ok: true, address: normalizedAddress });
  } catch (err) {
    console.error("[api/auth/link-wallet]", err);
    return c.json(
      { ok: false, error: "Internal server error", code: "INTERNAL_ERROR" },
      500 as any,
    );
  }
}
