/**
 * GET /api/v1/public/zerodev-config
 *
 * Returns ZeroDev bundler & paymaster URLs for a given chain.
 * The project ID is managed server-side — integrators never touch it.
 */
import type { Context } from "hono";
import { ZERODEV_PROJECT_ID } from "../../../config.js";
import { DEFAULT_CHAIN_ID } from "../../../lib/platform/default-chain.js";
import { corsHeaders } from "../../../middleware/cors.js";

const ARC_TESTNET_CHAIN_ID = 5042002;

function parseChainIdSet(raw: string | undefined): Set<number> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value > 0),
  );
}

function getExplicitZeroDevOverride(chainId: number) {
  const bundlerUrl =
    process.env[`ZERODEV_BUNDLER_RPC_${chainId}`] ??
    process.env.ZERODEV_BUNDLER_RPC ??
    "";
  const paymasterUrl =
    process.env[`ZERODEV_PAYMASTER_RPC_${chainId}`] ??
    process.env.ZERODEV_PAYMASTER_RPC ??
    "";

  return {
    bundlerUrl: bundlerUrl.trim(),
    paymasterUrl: paymasterUrl.trim(),
    hasExplicitOverride: Boolean(bundlerUrl.trim() || paymasterUrl.trim()),
  };
}

export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

export async function GET(c: Context) {
  const origin = c.req.header("origin");
  const chainIdRaw = c.req.query("chainId");
  const selfFundedRaw = c.req.query("selfFunded");
  const chainId = chainIdRaw
    ? Number.parseInt(chainIdRaw, 10)
    : DEFAULT_CHAIN_ID;

  if (!Number.isFinite(chainId) || chainId <= 0) {
    return c.json(
      { error: "Invalid chainId" },
      400,
      corsHeaders(origin),
    );
  }

  if (!ZERODEV_PROJECT_ID) {
    return c.json(
      { error: "ZeroDev project ID is not configured on the backend." },
      503,
      corsHeaders(origin),
    );
  }

  const isSelfFunded =
    selfFundedRaw === "true" ||
    parseChainIdSet(
      process.env.ZERODEV_SELF_FUNDED_CHAINS ||
        process.env.ARCENPAY_ZERODEV_SELF_FUNDED_CHAINS,
    ).has(chainId) ||
    process.env.ZERODEV_MODE === "self-funded" ||
    false;

  const { bundlerUrl: overrideBundlerUrl, paymasterUrl: overridePaymasterUrl } =
    getExplicitZeroDevOverride(chainId);

  if (
    chainId === ARC_TESTNET_CHAIN_ID &&
    (!overrideBundlerUrl || !overridePaymasterUrl)
  ) {
    return c.json(
      {
        error:
          "ZeroDev is not configured for Arc Testnet. Arc subscriptions can continue with direct-wallet autopay without a smart-account relay.",
      },
      404,
      corsHeaders(origin),
    );
  }

  const baseUrl = `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/${chainId}`;
  const suffix = isSelfFunded ? "?selfFunded=true" : "";

  const bundlerUrl =
    overrideBundlerUrl ||
    baseUrl + suffix;

  const paymasterUrl =
    overridePaymasterUrl ||
    baseUrl + suffix;

  const data = {
    chainId,
    bundlerUrl,
    paymasterUrl,
    selfFunded: isSelfFunded,
  };

  console.info("[backend][zerodev-config]", data);

  return c.json({ data }, 200, corsHeaders(origin));
}
