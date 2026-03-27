import { ArcenClient } from "@arcenpay/node";

// Singleton ArcenClient for server-side usage
// Initialized lazily so missing env vars only throw at runtime, not build time.

let _client: ArcenClient | null = null;

export function getArcenClient(): ArcenClient {
  if (_client) return _client;

  const apiKey = process.env.ARCENPAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ARCENPAY_API_KEY is not set. Copy .env.local.example → .env.local and add your key.",
    );
  }

  _client = new ArcenClient({
    apiKey,
    baseUrl: process.env.ARCENPAY_BASE_URL ?? "https://dashboard.arcenpay.xyz",
  });

  return _client;
}

/** The company wallet used by this demo — simulates a logged-in customer */
export function getDemoCompanyKeys() {
  return {
    wallet: process.env.DEMO_COMPANY_WALLET ?? "0x0000000000000000000000000000000000000001",
    id: process.env.DEMO_COMPANY_ID ?? undefined,
  };
}
