// ============================================================
//  @arcenpay/react — Lit Protocol Client Singleton
//  PRD §05 — Lit Protocol MPC Access Control
//
//  Lazily initializes a LitNodeClient and caches session
//  signatures for 24h to avoid redundant auth overhead.
//
//  Requires the following peer deps in the consuming app:
//    npm install @lit-protocol/lit-node-client @lit-protocol/constants @lit-protocol/auth-helpers
// ============================================================

let litNodeClient: any = null;
let initializePromise: Promise<any> | null = null;

/**
 * Returns a connected LitNodeClient singleton.
 * Multiple calls return the same instance without re-connecting.
 */
export async function getLitNodeClient(
  network: "habanero" | "manzano" = "habanero",
): Promise<any> {
  if (litNodeClient?.ready) return litNodeClient;

  // Prevent duplicate initialization from concurrent callers
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    let LitNodeClient: any;
    let LitNetwork: any;

    try {
      const [litCore, litConstants] = await Promise.all([
        import("@lit-protocol/lit-node-client"),
        import("@lit-protocol/constants"),
      ]);
      LitNodeClient = litCore.LitNodeClient;
      LitNetwork = litConstants.LitNetwork ?? litConstants.default?.LitNetwork;
    } catch {
      throw new Error(
        "[getLitNodeClient] Lit Protocol SDK is not installed. " +
          "Run: npm install @lit-protocol/lit-node-client @lit-protocol/constants @lit-protocol/auth-helpers",
      );
    }

    litNodeClient = new LitNodeClient({
      litNetwork:
        LitNetwork?.[network === "habanero" ? "Habanero" : "Manzano"] ??
        network,
      debug: process.env.NODE_ENV !== "production",
    });

    await litNodeClient.connect();
    return litNodeClient;
  })();

  const result = await initializePromise;
  initializePromise = null;
  return result;
}

/** Cache key for session sigs stored in sessionStorage */
const SESSION_SIG_CACHE_KEY = "meap_lit_session_sigs";
const SESSION_SIG_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CachedSessionSigs {
  sigs: unknown;
  expiresAt: number;
}

/** Returns cached Lit session signatures if they are still valid */
export function getCachedSessionSigs(): unknown | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_SIG_CACHE_KEY);
    if (!raw) return null;
    const cached: CachedSessionSigs = JSON.parse(raw);
    if (Date.now() > cached.expiresAt) {
      sessionStorage.removeItem(SESSION_SIG_CACHE_KEY);
      return null;
    }
    return cached.sigs;
  } catch {
    return null;
  }
}

/** Persists Lit session signatures to sessionStorage with a 24h TTL */
export function cacheSessionSigs(sigs: unknown): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CachedSessionSigs = {
      sigs,
      expiresAt: Date.now() + SESSION_SIG_TTL_MS,
    };
    sessionStorage.setItem(SESSION_SIG_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Silently fail if sessionStorage is unavailable (e.g., private browsing)
  }
}

/** Clears the Lit session sig cache (e.g., on wallet disconnect) */
export function clearSessionSigCache(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_SIG_CACHE_KEY);
}
