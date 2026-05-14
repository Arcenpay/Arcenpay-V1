import type { Context } from "hono";
import {
  OPTIONS as planOptions,
  handleCompanyPlanRequest,
} from "./company-plan.js";

export async function OPTIONS(c: Context) {
  return planOptions(c);
}

export async function POST(c: Context) {
  return handleCompanyPlanRequest(c, { previewOnly: true });
}
