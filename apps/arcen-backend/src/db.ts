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
  const isCloudOrSsl =
    connectionString.includes("sslmode=") ||
    connectionString.includes("aivencloud.com") ||
    connectionString.includes("railway.app") ||
    connectionString.includes("supabase.co") ||
    connectionString.includes("neon.tech") ||
    process.env.NODE_ENV === "production";

  if (isCloudOrSsl && connectionString.includes("sslmode=require") && !connectionString.includes("uselibpqcompat=true")) {
    connectionString += (connectionString.includes("?") ? "&" : "?") + "uselibpqcompat=true";
  }

  const pool = new Pool({
    connectionString,
    ssl: isCloudOrSsl ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DB_POOL_MAX || 10),
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

export const db = getClient();
