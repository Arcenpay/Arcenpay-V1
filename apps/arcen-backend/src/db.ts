import "./load-env.js";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/client/client.js";

type PrismaGlobal = {
  prisma?: PrismaClient;
  prismaPool?: Pool;
};

const globalForPrisma = globalThis as unknown as PrismaGlobal;
const RETRYABLE_PRISMA_ERROR_CODES = new Set(["P1001", "P1017", "P2024"]);
const PRISMA_RETRY_ATTEMPTS = 3;

if (!(process.env.DATABASE_URL || "").trim()) {
  const message =
    "[db] DATABASE_URL is not set — Postgres is unreachable and every DB-backed " +
    "request will fail. Set it to the service connection string (include " +
    "?sslmode=require for Aiven / Neon / Supabase).";
  // Fail fast in production: an empty URL silently builds a pool that targets
  // localhost, so the process reports itself healthy while every query 500s.
  if (process.env.NODE_ENV === "production") throw new Error(message);
  console.warn(message);
}

/** Host (no credentials) of the configured database, for log output only. */
function safeDatabaseHost(): string {
  const raw = (process.env.DATABASE_URL || "").trim();
  if (!raw) return "<unset>";
  try {
    return new URL(raw).host || "<no-host>";
  } catch {
    return "<unparseable DATABASE_URL>";
  }
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (current instanceof Error && current.message) {
      messages.push(current.message.toLowerCase());
    }
    if (typeof current === "object" && "cause" in current) {
      queue.push((current as { cause?: unknown }).cause);
    }
  }
  return messages;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrismaState(): { client: PrismaClient; pool: Pool } {
  let connectionString = process.env.DATABASE_URL || "";
  // An explicit `sslmode=disable` must win. Passing an `ssl` option overrides
  // whatever pg's connection-string parser inferred, so without this the blanket
  // production default would force TLS onto a host that does not speak it — an
  // internal/private Postgres (e.g. Railway's internal URL) then fails with
  // "The server does not support SSL connections".
  const sslDisabled = /[?&]sslmode=disable(?:&|$)/i.test(connectionString);
  const isCloudOrSsl =
    !sslDisabled &&
    (connectionString.includes("sslmode=") ||
      connectionString.includes("aivencloud.com") ||
      connectionString.includes("railway.app") ||
      connectionString.includes("supabase.co") ||
      connectionString.includes("neon.tech") ||
      process.env.NODE_ENV === "production");

  if (isCloudOrSsl && connectionString.includes("sslmode=require") && !connectionString.includes("uselibpqcompat=true")) {
    connectionString += (connectionString.includes("?") ? "&" : "?") + "uselibpqcompat=true";
  }

  const pool = new Pool({
    connectionString,
    ssl: isCloudOrSsl ? { rejectUnauthorized: false } : undefined,
    // INVARIANT: DB_POOL_MAX × running replicas ≤ Postgres max_connections
    // (minus headroom for the facilitator). A transaction-mode pooler
    // (PgBouncer/Supavisor) in front of Postgres multiplies the effective
    // ceiling; keep this conservative and rely on the pooler for aggregate
    // concurrency rather than raising it per process.
    max: Number(process.env.DB_POOL_MAX || 10),
    min: Number(process.env.DB_POOL_MIN || 0),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    maxLifetimeSeconds: 60,
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  pool.on("error", () => {
    void resetPrismaClient(pool);
  });
  return { client, pool };
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma || !globalForPrisma.prismaPool) {
    const state = buildPrismaState();
    globalForPrisma.prisma = state.client;
    globalForPrisma.prismaPool = state.pool;
  }
  return globalForPrisma.prisma;
}

function isRetryableConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientRustPanicError) return true;
  const code = getErrorCode(error);
  if ((error instanceof Prisma.PrismaClientKnownRequestError && code !== null) || code !== null) {
    if (RETRYABLE_PRISMA_ERROR_CODES.has(code)) return true;
  }
  const messages = collectErrorMessages(error);
  return messages.some(
    (message) =>
      message.includes("server has closed the connection") ||
      message.includes("connection terminated unexpectedly") ||
      message.includes("terminating connection due to administrator command") ||
      message.includes("can't reach database server") ||
      message.includes("connection reset") ||
      message.includes("econnreset") ||
      message.includes("socket closed unexpectedly") ||
      message.includes("the database server closed the connection"),
  );
}

// Single-flight + rate-limited. Previously every retryable error tore down and
// rebuilt the pool with no guard, so a storm of failing requests (which is
// exactly what a failing/retrying caller produces) created one new pool per
// request. The old pools were still open while the new ones connected, so
// Postgres hit its connection ceiling, which produced MORE errors, which
// triggered MORE resets — the connection death-spiral. One reset at a time,
// and never more often than MIN_RESET_INTERVAL_MS.
let resetInFlight: Promise<void> | null = null;
let lastResetAt = 0;
const MIN_RESET_INTERVAL_MS = 5_000;

async function resetPrismaClient(expectedPool?: Pool): Promise<void> {
  const currentPool = globalForPrisma.prismaPool;
  if (expectedPool && currentPool !== expectedPool) return;

  if (resetInFlight) return resetInFlight;
  if (Date.now() - lastResetAt < MIN_RESET_INTERVAL_MS) return;

  resetInFlight = (async () => {
    const client = globalForPrisma.prisma;
    const pool = globalForPrisma.prismaPool;
    globalForPrisma.prisma = undefined;
    globalForPrisma.prismaPool = undefined;
    await Promise.allSettled([client?.$disconnect(), pool?.end()]);
    lastResetAt = Date.now();
  })().finally(() => {
    resetInFlight = null;
  });

  return resetInFlight;
}

export async function withPrismaReconnect<T>(
  operation: (client: PrismaClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PRISMA_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation(getClient());
    } catch (error) {
      lastError = error;
      if (!isRetryableConnectionError(error) || attempt === PRISMA_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await resetPrismaClient();
      await sleep(100 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * `db` is a Proxy, not a captured client instance.
 *
 * WHY: `resetPrismaClient()` disconnects and replaces the pool on a connection
 * failure. With a plain `export const db = getClient()` the binding would be
 * frozen to the ORIGINAL client forever, so every direct `db.` caller would keep
 * issuing queries against a disposed pool while only `withPrismaReconnect`
 * callers recovered. Resolving the client on each property access repairs every
 * call site at once.
 *
 * Function members (`$transaction`, `$queryRaw`, …) are bound to the live
 * client so `this` resolves correctly. Model delegates (`db.user`, …) are
 * objects whose methods bind internally and are returned as-is.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, prop) {
    return prop in getClient();
  },
  getPrototypeOf() {
    return Object.getPrototypeOf(getClient());
  },
});

/**
 * Graceful shutdown: disconnect Prisma and end the pool.
 *
 * Small managed-Postgres plans (free tiers especially) cap `max_connections`
 * low. Every redeploy starts a new container while the old one is still being
 * torn down; if the process never closes its sockets, the old pool's
 * connections linger until the server times them out and the next boot can hit
 * "too many clients". Closing them explicitly on SIGTERM is what keeps a
 * tight plan usable across frequent deploys.
 */
export async function closeDatabase(): Promise<void> {
  const client = globalForPrisma.prisma;
  const pool = globalForPrisma.prismaPool;
  globalForPrisma.prisma = undefined;
  globalForPrisma.prismaPool = undefined;
  await Promise.allSettled([client?.$disconnect(), pool?.end()]);
}

/**
 * Boot-time connectivity probe.
 *
 * Runs after the port is bound so an unreachable database never delays startup
 * (which would trip the platform health check and start a restart loop), but is
 * reported loudly — instead of surfacing as a wave of unexplained 500s. That is
 * the exact failure mode of a deleted/renamed managed Postgres, whose hostname
 * resolves to NXDOMAIN.
 */
export async function verifyDatabaseConnection(attempts = 5): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await db.$queryRawUnsafe("SELECT 1");
      return true;
    } catch (error) {
      // Prisma prints a multi-line message whose LAST non-empty line carries the
      // actual cause (e.g. "Can't reach database server at …"); the first line is
      // just the `Invalid \`prisma.…\` invocation:` wrapper.
      const lines =
        error instanceof Error
          ? error.message
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
          : [];
      const detail = lines.length > 0 ? lines[lines.length - 1] : String(error);
      if (attempt === attempts) {
        console.error(
          `\n${"=".repeat(78)}\n` +
            `[db] POSTGRES UNREACHABLE at ${safeDatabaseHost()} after ${attempts} attempts.\n` +
            `     Every DB-backed request returns 500 until this is fixed.\n` +
            `     Check that the database still exists (a deleted or renamed managed\n` +
            `     Postgres resolves to NXDOMAIN) and that DATABASE_URL is current.\n` +
            `     Last error: ${detail}\n` +
            `${"=".repeat(78)}\n`,
        );
      } else {
        console.warn(
          `[db] connectivity probe ${attempt}/${attempts} failed ` +
            `(${safeDatabaseHost()}): ${detail}`,
        );
        await sleep(500 * attempt);
      }
    }
  }
  return false;
}
