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
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
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

async function resetPrismaClient(expectedPool?: Pool): Promise<void> {
  const currentClient = globalForPrisma.prisma;
  const currentPool = globalForPrisma.prismaPool;
  if (expectedPool && currentPool !== expectedPool) return;

  globalForPrisma.prisma = undefined;
  globalForPrisma.prismaPool = undefined;
  await Promise.allSettled([currentClient?.$disconnect(), currentPool?.end()]);
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
