import { Hono } from "hono";
import { requireApiKeyAuth } from "../../../middleware/auth.js";
import { listCompanies, createCompany } from "./handlers.js";

export const companiesRoutes = new Hono()
  .get("/", requireApiKeyAuth(), listCompanies)
  .post("/", requireApiKeyAuth(), createCompany);
