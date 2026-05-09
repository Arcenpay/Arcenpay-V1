import { Hono } from "hono";
import { listCompanies, createCompany } from "./handlers.js";
import { GET as getCompanyById, PATCH as updateCompanyById, DELETE as deleteCompanyById } from "../company-by-id.js";

export const companiesRoutes = new Hono()
  .get("/", listCompanies)
  .post("/", createCompany)
  .get("/:id", getCompanyById)
  .patch("/:id", updateCompanyById)
  .delete("/:id", deleteCompanyById);
