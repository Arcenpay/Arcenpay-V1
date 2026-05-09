import { ArcenClient } from "@arcenpay/node";

// Singleton ArcenClient for server-side usage
// Initialized lazily so missing env vars only throw at runtime, not build time.
let demoNodeClient: ArcenClient | null = null;
const DEFAULT_DEMO_COMPANY_ID = "arcen-demo-company";

export function getDemoNodeClient(): ArcenClient {
  if (demoNodeClient) return demoNodeClient;

  const apiKey = process.env.ARCENPAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ARCENPAY_API_KEY is not set. Copy .env.local.example → .env.local and add your key.",
    );
  }

  demoNodeClient = new ArcenClient({
    apiKey,
  });

  return demoNodeClient;
}

/** The company wallet used by this demo — simulates a logged-in customer */
export function getDemoCompanyKeys() {
  return {
    wallet:
      process.env.DEMO_COMPANY_WALLET ??
      "0x0000000000000000000000000000000000000001",
    id: process.env.DEMO_COMPANY_ID ?? DEFAULT_DEMO_COMPANY_ID,
  };
}

export function getDemoCompanyIdentity() {
  const companyKeys = getDemoCompanyKeys();

  return {
    ...companyKeys,
    name: process.env.DEMO_COMPANY_NAME ?? companyKeys.id ?? "Demo Company",
  };
}

export function getDemoUserIdentity() {
  const companyKeys = getDemoCompanyKeys();
  const userId = process.env.DEMO_USER_ID ?? companyKeys.id ?? "demo-user";

  return {
    id: userId,
    wallet: process.env.DEMO_USER_WALLET ?? companyKeys.wallet,
    name: process.env.DEMO_USER_NAME ?? "Demo User",
    email: process.env.DEMO_USER_EMAIL ?? undefined,
  };
}
