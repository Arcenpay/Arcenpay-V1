import { Hono } from "hono";
import { v1Router } from "./v1/index.js";

export const appRouter = new Hono().route("/", v1Router);
