import { Hono } from "hono";
import { registerEmail } from "./email.js";
import { lookupSubscriber } from "./lookup.js";

export const subscriberRoutes = new Hono()
  .post("/email", registerEmail)
  .get("/lookup", lookupSubscriber);
