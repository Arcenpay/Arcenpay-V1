import { Hono } from "hono";
import type { Context } from "hono";
import {
  requireAnyAuth,
  isAnyAuthError,
} from "../../lib/auth/require-any-auth.js";
import { mandateService } from "../../services/mandate.service.js";

/**
 * Agent payment-mandate routes.
 *
 * SECURITY: these routes previously had NO authentication at all. A mandate is
 * a payment authorisation object, so the consequences were:
 *   - `POST /revoke` let ANY anonymous caller revoke ANY mandate id, and the
 *     `revokedBy` field was taken verbatim from the request body, so the audit
 *     trail recorded whatever the attacker chose to type.
 *   - `GET /:id/status` disclosed mandate state to anyone who could guess an id.
 *
 * Every route now requires an authenticated principal (team-scoped API key or a
 * dashboard session), and the recorded revoker is derived from that principal
 * rather than trusted from the body.
 */
export const mandateRoutes = new Hono()
  .get("/:id/status", async (c: Context) => {
    const auth = await requireAnyAuth(c, { allow: ["SECRET", "RESTRICTED"] });
    if (isAnyAuthError(auth)) {
      return c.json({ error: auth.error }, auth.status as any);
    }

    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "Missing mandate id parameter" }, 400);
    }

    const status = mandateService.getMandateStatus(id);
    return c.json(status);
  })
  .post("/revoke", async (c: Context) => {
    const auth = await requireAnyAuth(c, { allow: ["SECRET", "RESTRICTED"] });
    if (isAnyAuthError(auth)) {
      return c.json({ error: auth.error }, auth.status as any);
    }

    let body: { mandateId?: string; reason?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.mandateId) {
      return c.json({ error: "Missing mandateId in request body" }, 400);
    }

    // The revoker identity comes from the authenticated principal, NOT from the
    // request body — otherwise any caller could attribute a revocation to
    // somebody else.
    const revokedBy =
      auth.source === "api_key" ? `api_key:${auth.apiKeyId}` : `session:${auth.sessionId}`;

    const record = mandateService.revokeMandate(
      body.mandateId,
      body.reason,
      revokedBy,
    );

    return c.json({
      revoked: true,
      ...record,
    });
  });
