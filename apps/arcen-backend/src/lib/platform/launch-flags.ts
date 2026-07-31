function isEnabled(
  value: string | undefined,
  defaultValue = false,
): boolean {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export const SELF_SERVE_PLAN_CHANGES_ENABLED = isEnabled(
  process.env.ARCENPAY_ENABLE_SELF_SERVE_PLAN_CHANGES ??
    process.env.NEXT_PUBLIC_ARCENPAY_ENABLE_PORTAL_PLAN_CHANGES,
  true,
);

export const SELF_SERVE_CANCELLATION_ENABLED = isEnabled(
  process.env.ARCENPAY_ENABLE_SELF_SERVE_CANCELLATION ??
    process.env.NEXT_PUBLIC_ARCENPAY_ENABLE_PORTAL_CANCELLATION,
  true,
);

export const SUBGRAPH_REQUIRED = isEnabled(
  process.env.ARCENPAY_REQUIRE_SUBGRAPH ??
    process.env.NEXT_PUBLIC_ARCENPAY_REQUIRE_SUBGRAPH,
);

// Mainnet environments remain opt-in until production contracts, RPC,
// facilitator, token, and treasury configuration have been verified.
export const PRODUCTION_ENVIRONMENTS_ENABLED = isEnabled(
  process.env.ARCENPAY_ENABLE_PRODUCTION_ENVIRONMENTS,
);
