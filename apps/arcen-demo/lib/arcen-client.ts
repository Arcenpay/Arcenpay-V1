/**
 * Singleton ArcenClient for server-side usage in API routes.
 * Reads config from environment variables.
 */
import { ArcenClient } from "@meap/node";

export function getArcenClient(): ArcenClient {
  const apiKey = process.env.ARCEN_API_KEY;
  if (!apiKey) {
    throw new Error("ARCEN_API_KEY is not set. See README for setup.");
  }
  return new ArcenClient({
    apiKey,
    baseUrl: process.env.ARCEN_BASE_URL || "http://localhost:3000",
  });
}
