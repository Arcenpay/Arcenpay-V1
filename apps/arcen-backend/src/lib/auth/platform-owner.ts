import type { Context } from "hono";
import { requireTeamRoles, type AuthorizedContext, type AuthError } from "./api-auth.js";

export const PLATFORM_OWNER_WALLET = "0x38f62ccfd6f771ef9e48e3bb86a3e0413ae5319b";

export async function requirePlatformOwner(
  c: Context,
): Promise<AuthorizedContext | AuthError> {
  const auth = await requireTeamRoles(c, ["OWNER"]);
  if ("status" in auth) return auth;

  if (auth.team.walletAddress?.trim().toLowerCase() !== PLATFORM_OWNER_WALLET) {
    return {
      error: "Platform billing administration is restricted to the canonical platform owner wallet.",
      status: 403,
    };
  }

  return auth;
}
