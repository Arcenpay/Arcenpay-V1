/**
 * zkTLS integration via Reclaim Protocol.
 *
 * Reclaim Protocol uses zkTLS (TLS proofs) to let users prove statements
 * about HTTPS responses without revealing credentials or raw response data.
 *
 * Flow:
 *  1. Backend creates a proof request (session) for a specific provider
 *  2. User scans QR / opens deeplink in Reclaim app
 *  3. Reclaim app makes HTTPS request, generates ZK proof of the response
 *  4. Reclaim calls our callback URL with the signed proof
 *  5. We verify the proof and extract claims
 *  6. Claims stored in ZkTlsProof table → used by flag engine
 *
 * Docs: https://docs.reclaimprotocol.org/
 */

import { createHash } from "crypto";

// Lazy-load Reclaim SDK to avoid issues if package is not installed yet
// webpackIgnore comment tells webpack/Next.js not to bundle this optional dep
async function getReclaimSdk() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await import(/* webpackIgnore: true */ "@reclaimprotocol/js-sdk").catch(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      () => require("@reclaimprotocol/js-sdk"),
    );
    return mod as typeof import("@reclaimprotocol/js-sdk");
  } catch {
    throw new Error(
      "Reclaim Protocol SDK not installed. Run: npm install @reclaimprotocol/js-sdk",
    );
  }
}

export interface ReclaimProofVerification {
  valid: boolean;
  providerId: string;
  providerName: string;
  claims: Record<string, string>;
  proofHash: string;
  error?: string;
}

/**
 * Verify a Reclaim Protocol proof submitted by a client.
 * Returns structured claims if valid.
 */
export async function verifyReclaimProof(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proof: any,
): Promise<ReclaimProofVerification> {
  const sdk = await getReclaimSdk();

  try {
    const isValid = await sdk.verifyProof(proof);

    if (!isValid) {
      return { valid: false, providerId: "", providerName: "", claims: {}, proofHash: "" };
    }

    // Extract provider info and claims
    const providerId: string =
      proof?.claimData?.provider ??
      proof?.identifier ??
      "unknown";

    const providerName: string =
      proof?.claimData?.context?.providerName ??
      proof?.provider ??
      providerId;

    // Parse structured claims from the proof context
    let claims: Record<string, string> = {};
    try {
      const context = proof?.claimData?.context;
      if (typeof context === "string") {
        const parsed = JSON.parse(context);
        claims = parsed.extractedParameters ?? parsed.claims ?? {};
      } else if (context?.extractedParameters) {
        claims = context.extractedParameters;
      }
    } catch {
      // Claims parsing is best-effort
    }

    // Create a deterministic hash for replay protection
    const proofHash = createHash("sha256")
      .update(JSON.stringify(proof?.claimData ?? proof))
      .digest("hex");

    return { valid: true, providerId, providerName, claims, proofHash };
  } catch (err) {
    return {
      valid: false,
      providerId: "",
      providerName: "",
      claims: {},
      proofHash: "",
      error: err instanceof Error ? err.message : "Proof verification failed",
    };
  }
}

/**
 * Create a Reclaim proof request session.
 * Returns a requestUrl (QR code content) and sessionId for tracking.
 */
export async function createReclaimRequest(
  providerId: string,
  callbackUrl: string,
): Promise<{ requestUrl: string; sessionId: string }> {
  const appId = process.env.RECLAIM_APP_ID;
  const appSecret = process.env.RECLAIM_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("RECLAIM_APP_ID and RECLAIM_APP_SECRET must be set");
  }

  const sdk = await getReclaimSdk();
  const client = new sdk.ReclaimProofRequest(appId, appSecret, providerId);

  await client.setAppCallbackUrl(callbackUrl);

  const requestUrl = await client.getRequestUrl();
  const sessionId = client.getSessionId?.() ?? createHash("sha256").update(requestUrl).digest("hex").slice(0, 16);

  return { requestUrl, sessionId };
}

/**
 * Well-known Reclaim provider IDs for common Web2 services.
 * Teams can also use custom providers they've created in the Reclaim dashboard.
 */
export const RECLAIM_PROVIDERS = {
  GITHUB_STARS: "github-stars",
  TWITTER_FOLLOWERS: "twitter-followers",
  GOOGLE_ACCOUNT: "google-account",
  STRIPE_CUSTOMER: "stripe-customer-id",
  LINKEDIN_PROFILE: "linkedin-profile",
} as const;
