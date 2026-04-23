function isEnabled(value: string | undefined): boolean {
  return (value || "").trim().toLowerCase() === "true";
}

export const SELF_SERVE_PLAN_CHANGES_ENABLED = isEnabled(
  process.env.ARCENPAY_ENABLE_SELF_SERVE_PLAN_CHANGES ??
    process.env.NEXT_PUBLIC_ARCENPAY_ENABLE_PORTAL_PLAN_CHANGES,
);

export const SELF_SERVE_CANCELLATION_ENABLED = isEnabled(
  process.env.ARCENPAY_ENABLE_SELF_SERVE_CANCELLATION ??
    process.env.NEXT_PUBLIC_ARCENPAY_ENABLE_PORTAL_CANCELLATION,
);

export const SUBGRAPH_REQUIRED = isEnabled(
  process.env.ARCENPAY_REQUIRE_SUBGRAPH ??
    process.env.NEXT_PUBLIC_ARCENPAY_REQUIRE_SUBGRAPH,
);
