import { Hono } from "hono";
import { requirePermission } from "../../../middleware/auth.js";
import { apiSuccess } from "../../../utils/api-response.js";
import { handleProviderFlags } from "./provider-flags.js";

export const entitlementsRoutes = new Hono()
  .get("/", requirePermission("catalog:read"), (c) => {
    return apiSuccess(c, { message: "List entitlements" });
  })
  .all("/provider/:provider/flags/*", handleProviderFlags);
