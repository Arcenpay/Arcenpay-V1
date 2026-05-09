import { Hono } from "hono";
import type { Context } from "hono";
import { sendEmailAuthCode } from "../../../lib/billing/email.js";
import { lookupSubscriber } from "./lookup.js";

async function registerEmail(c: Context) {
  const body = await c.req.json() .catch(() => ({}));
  const { email } = body as { email?: string };
  if (!email) return c.json({ ok: false, error: "email required", code: "BAD_REQUEST" }, 400 as any);
  await sendEmailAuthCode(email, "000000");
  return c.json({ ok: true, data: { sent: true } });
}

export const subscriberRoutes = new Hono()
  .post("/email", registerEmail)
  .get("/lookup", lookupSubscriber);
