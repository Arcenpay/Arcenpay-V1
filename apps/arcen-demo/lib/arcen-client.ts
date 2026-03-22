/**
 * Singleton ArcenClient for server-side usage in API routes.
 * Priority: runtime demoConfig (set via /api/config) → environment variables.
 */
import { ArcenClient } from "@meap/node";

// Import demoConfig from the route module so runtime config is used
// when ARCEN_API_KEY is not in the environment.
let _cachedClient: ArcenClient | null = null;
let _cachedKey = "";

export function getArcenClient(): ArcenClient {
  // Try env vars first (fastest path)
  const apiKey = process.env.ARCEN_API_KEY;
  const baseUrl = process.env.ARCEN_BASE_URL || "http://localhost:3000";

  if (apiKey) {
    if (_cachedKey === apiKey && _cachedClient) return _cachedClient;
    _cachedKey = apiKey;
    _cachedClient = new ArcenClient({ apiKey, baseUrl });
    return _cachedClient;
  }

  // Fall back to runtime config (set via POST /api/config from the setup screen)
  // Use a dynamic require to avoid circular imports
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { demoConfig } = require("../app/api/config/route") as {
      demoConfig: { apiKey: string; baseUrl: string } | null;
    };
    if (demoConfig?.apiKey) {
      if (_cachedKey === demoConfig.apiKey && _cachedClient) return _cachedClient;
      _cachedKey = demoConfig.apiKey;
      _cachedClient = new ArcenClient({
        apiKey: demoConfig.apiKey,
        baseUrl: demoConfig.baseUrl || "http://localhost:3000",
      });
      return _cachedClient;
    }
  } catch {
    // dynamic require may fail in some environments — that's fine
  }

  throw new Error(
    "ArcenPay API key not configured. " +
      "Set ARCEN_API_KEY in .env.local or complete the setup screen.",
  );
}
