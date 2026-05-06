import { ArcenClient } from "@arcenpay/node";
import type {
  EntitlementResult,
  FlagResult,
  ConsumeEntitlementResult,
  IdentifyResult,
} from "@arcenpay/sdk";

// Singleton ArcenClient for server-side usage
// Initialized lazily so missing env vars only throw at runtime, not build time.

type DemoCompanyKeys = {
  wallet?: string;
  id?: string;
};

type DemoUserKeys = {
  id?: string;
  wallet?: string;
};

type DemoIdentifyInput = {
  company: Record<string, unknown>;
  user?: Record<string, unknown>;
  expiresIn?: number;
};

type DemoTrackInput = {
  name: string;
  company?: DemoCompanyKeys;
  user?: DemoUserKeys;
  traits?: Record<string, unknown>;
  idempotencyKey?: string;
};

type DemoConsumeInput = {
  featureKey: string;
  company?: DemoCompanyKeys;
  user?: DemoUserKeys;
  traits?: Record<string, unknown>;
  idempotencyKey?: string;
};

export interface DemoArcenClient {
  identify(input: DemoIdentifyInput): Promise<IdentifyResult>;
  checkEntitlement(
    featureKey: string,
    company: DemoCompanyKeys,
  ): Promise<EntitlementResult>;
  checkFlag(featureKey: string, company: DemoCompanyKeys): Promise<FlagResult>;
  track(input: DemoTrackInput): Promise<void>;
  consumeEntitlement(
    input: DemoConsumeInput,
  ): Promise<ConsumeEntitlementResult>;
}

let _client: DemoArcenClient | null = null;
const DEFAULT_DEMO_COMPANY_ID = "arcen-demo-company";

export function getArcenClient(): DemoArcenClient {
  if (_client) return _client;

  const apiKey = process.env.ARCENPAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ARCENPAY_API_KEY is not set. Copy .env.local.example → .env.local and add your key.",
    );
  }

  const rawClient = new ArcenClient({
    apiKey,
    baseUrl: process.env.ARCENPAY_BASE_URL ?? "http://localhost:3000",
  });

  const client: DemoArcenClient = {
    identify: (input) => rawClient.identify(input as never),
    checkEntitlement: (featureKey, company) =>
      rawClient.checkEntitlement(featureKey, company as never),
    checkFlag: (featureKey, company) =>
      rawClient.checkFlag(featureKey, company as never),
    track: (input) => rawClient.track(input as never),
    consumeEntitlement: (input) =>
      (
        rawClient as ArcenClient & {
          consumeEntitlement(
            payload: DemoConsumeInput,
          ): Promise<ConsumeEntitlementResult>;
        }
      ).consumeEntitlement(input),
  };
  _client = client;

  return client;
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

export async function ensureDemoIdentity(): Promise<void> {
  const apiKey = process.env.ARCENPAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ARCENPAY_API_KEY is not set. Copy .env.local.example → .env.local and add your key.",
    );
  }

  const baseUrl = (
    process.env.ARCENPAY_BASE_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");

  const response = await fetch(`${baseUrl}/api/v1/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "identify",
      company: getDemoCompanyIdentity(),
      user: getDemoUserIdentity(),
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ??
        `Failed to identify demo company/user (${response.status})`,
    );
  }
}
