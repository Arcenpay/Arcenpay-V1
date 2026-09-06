import { Hono } from "hono";
import type { Context } from "hono";
import { mandateService } from "../../services/mandate.service.js";

export const mandateRoutes = new Hono()
  .get("/:id/status", async (c: Context) => {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "Missing mandate id parameter" }, 400);
    }
    const status = mandateService.getMandateStatus(id);
    return c.json(status);
  })
  .post("/revoke", async (c: Context) => {
    let body: { mandateId?: string; reason?: string; revokedBy?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.mandateId) {
      return c.json({ error: "Missing mandateId in request body" }, 400);
    }

    const record = mandateService.revokeMandate(body.mandateId, body.reason, body.revokedBy);
    return c.json({
      revoked: true,
      ...record,
    });
  });
