import { Hono } from "hono";
import { getActiveProofs } from "./active.js";
import { getProofHistory } from "./history.js";

export const proofsRoutes = new Hono()
  .get("/active", getActiveProofs)
  .get("/history", getProofHistory);
