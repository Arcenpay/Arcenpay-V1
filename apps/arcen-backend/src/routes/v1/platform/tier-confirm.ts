import type { Context } from "hono";

export async function postTierConfirm(c: Context) {
  c.header("Deprecation", "true");
  c.header("Sunset", "2026-12-31");
  return c.json({
    ok: false,
    error: "PLATFORM_TIER_FLOW_DEPRECATED",
    message: "Use the enrolled platform billing portal and generic subscription flow.",
  }, 410 as any);
}
