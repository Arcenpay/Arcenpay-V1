import { Hono } from "hono";
import { requireFacilitatorAuth } from "../../../middleware/auth.js";
import { GET as billingEventsList, POST as billingEventsIngest } from "./events.js";

export const billingRoutes = new Hono()
  .get("/events", requireFacilitatorAuth(), billingEventsList)
  .post("/events", requireFacilitatorAuth(), billingEventsIngest);
