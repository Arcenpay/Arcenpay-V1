/**
 * Stripe-style dual-auth for invoice routes.
 *
 * Invoices can be read/managed either:
 *  - Over the REST API with a server-side key (`sk_`/`rk_`) that carries the
 *    matching invoice permission (see API_PERMISSIONS). Publishable `pk_`
 *    keys are ALWAYS rejected — invoice records contain customer PII, amounts,
 *    and payment proofs, so they are never client-safe.
 *  - From the dashboard with a session cookie + team role that has the
 *    matching `invoices:*` RBAC permission.
 *
 * Returns a normalized context so invoice handlers can run identically for
 * both sources.
 */

import type { Context } from "hono";
import { requireApiKey, isApiKeyError, isApiKeyToken, type ApiKeyTypeName } from "./api-key-auth.js";
import { requirePermission, isErrorResponse, type AuthError, type AuthorizedContext } from "./api-auth.js";

export type InvoiceAuthContext = {
  teamId: string;
  source: "api_key" | "session";
  apiKeyId?: string;
  environmentId?: string | null;
  userId?: string | null;
  walletAddress?: string | null;
  /** Session context (dashboard only). */
  session?: AuthorizedContext | null;
};

export function isInvoiceAuthError(v: unknown): v is AuthError {
  return (
    typeof v === "object" &&
    v !== null &&
    "error" in v &&
    "status" in v
  );
}

/** API-key permissions that are sufficient for each invoice operation class. */
const API_KEY_PERMISSIONS: Record<
  "read" | "write" | "send",
  string[]
> = {
  // `payments.write` and `invoices.write` imply full read+write over billing
  // records (Stripe-style: a key that can manage payments can see invoices).
  // Semantics are OR — possessing ANY listed permission is sufficient.
  read: ["invoices.read", "invoices.write", "invoices.send", "payments.write"],
  write: ["invoices.write", "payments.write"],
  send: ["invoices.send", "invoices.write", "payments.write"],
};

function hasAnyInvoicePermission(
  keyType: "SECRET" | "PUBLISHABLE" | "RESTRICTED",
  owned: string[],
  required: string[],
): boolean {
  // A SECRET key with no explicit permission list is full-access (legacy
  // Stripe-equivalent "standard secret"). Restricted keys ALWAYS require an
  // explicit permission list.
  if (keyType === "SECRET" && owned.length === 0) return true;
  return required.some((permission) => owned.includes(permission));
}

/**
 * Resolve team access for an invoice route.
 *
 * @param opts.rolePermission  RBAC permission required when the request is a
 *                             dashboard session (invoices:read|write|send).
 * @param opts.apiPermission   Invoice operation class for API-key permission
 *                             matching (read|write|send).
 */
export async function requireInvoiceAuth(
  c: Context,
  opts: {
    rolePermission: "invoices:read" | "invoices:write" | "invoices:send";
    apiPermission: "read" | "write" | "send";
  },
): Promise<InvoiceAuthContext | AuthError> {
  const header = c.req.header("authorization") ?? c.req.header("x-api-key");

  // ── API-key path (server-side keys only — never publishable) ──────────────
  if (header && isApiKeyToken(header)) {
    const keyCtx = await requireApiKey(c.req.raw, {
      allow: ["SECRET", "RESTRICTED"] as ApiKeyTypeName[],
    });
    if (isApiKeyError(keyCtx)) return keyCtx;

    // OR-semantics permission check (see hasAnyInvoicePermission). A
    // RESTRICTED key always needs an explicit matching permission; a SECRET
    // key with no permissions is full-access.
    if (
      !hasAnyInvoicePermission(
        keyCtx.keyType,
        keyCtx.permissions,
        API_KEY_PERMISSIONS[opts.apiPermission],
      )
    ) {
      return {
        error: `Missing invoice permission(s) for this operation. Required one of: ${API_KEY_PERMISSIONS[opts.apiPermission].join(", ")}`,
        status: 403,
      };
    }

    return {
      teamId: keyCtx.teamId,
      source: "api_key",
      apiKeyId: keyCtx.apiKeyId,
      environmentId: keyCtx.environmentId ?? null,
      walletAddress: null,
      userId: null,
    };
  }

  // ── Dashboard session path ────────────────────────────────────────────────
  const auth = await requirePermission(c, opts.rolePermission);
  if (isErrorResponse(auth)) return auth;
  return {
    teamId: auth.team.teamId,
    source: "session",
    environmentId: auth.session.activeEnvironmentId ?? null,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress ?? null,
    session: auth,
  };
}
