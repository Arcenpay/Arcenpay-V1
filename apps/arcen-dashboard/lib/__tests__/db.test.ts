import { beforeEach, describe, expect, it, vi } from "vitest";

type MockClient = {
  authSession: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  $disconnect: ReturnType<typeof vi.fn>;
};

type MockPool = {
  end: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

const clientQueue: MockClient[] = [];
const poolQueue: MockPool[] = [];

class PrismaClientKnownRequestError extends Error {
  code: string;

  constructor(message: string, { code }: { code: string }) {
    super(message);
    this.code = code;
  }
}

class PrismaClientInitializationError extends Error {}
class PrismaClientRustPanicError extends Error {}

vi.mock("pg", () => ({
  Pool: vi.fn(function MockPool() {
    return poolQueue.shift() ?? { end: vi.fn(async () => undefined) };
  }),
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: vi.fn(function MockPrismaPg() {
    return {};
  }),
}));

vi.mock("../src/generated/prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError,
    PrismaClientInitializationError,
    PrismaClientRustPanicError,
  },
  PrismaClient: vi.fn(function MockPrismaClient() {
    return (
      clientQueue.shift() ?? {
        authSession: {
          findUnique: vi.fn(),
        },
        $disconnect: vi.fn(async () => undefined),
      }
    );
  }),
}));

function createClient(): MockClient {
  return {
    authSession: {
      findUnique: vi.fn(),
    },
    $disconnect: vi.fn(async () => undefined),
  };
}

function createPool(): MockPool {
  return {
    end: vi.fn(async () => undefined),
    on: vi.fn(),
  };
}

describe("db reconnect handling", () => {
  beforeEach(() => {
    clientQueue.length = 0;
    poolQueue.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
    delete (globalThis as { prisma?: unknown }).prisma;
    delete (globalThis as { prismaPool?: unknown }).prismaPool;
  });

  it("retries with a fresh client when Prisma reports P1017", async () => {
    const firstClient = createClient();
    const secondClient = createClient();
    const firstPool = createPool();
    const secondPool = createPool();

    firstClient.authSession.findUnique.mockRejectedValueOnce(
      new PrismaClientKnownRequestError("Server has closed the connection.", {
        code: "P1017",
      }),
    );
    secondClient.authSession.findUnique.mockResolvedValueOnce({ id: "session-1" });

    clientQueue.push(firstClient, secondClient);
    poolQueue.push(firstPool, secondPool);

    const { withPrismaReconnect } = await import("../db");
    const record = await withPrismaReconnect((client) =>
      client.authSession.findUnique({ where: { tokenHash: "hash" } }),
    );

    expect(record).toEqual({ id: "session-1" });
    expect(firstClient.$disconnect).toHaveBeenCalledTimes(1);
    expect(firstPool.end).toHaveBeenCalledTimes(1);
    expect(secondClient.authSession.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: "hash" },
    });
  });

  it("retries delegate calls made through the exported db proxy", async () => {
    const firstClient = createClient();
    const secondClient = createClient();
    const firstPool = createPool();
    const secondPool = createPool();

    firstClient.authSession.findUnique.mockRejectedValueOnce(
      new PrismaClientKnownRequestError("Server has closed the connection.", {
        code: "P1017",
      }),
    );
    secondClient.authSession.findUnique.mockResolvedValueOnce({ id: "session-2" });

    clientQueue.push(firstClient, secondClient);
    poolQueue.push(firstPool, secondPool);

    const { db } = await import("../db");
    const record = await db.authSession.findUnique({
      where: { tokenHash: "hash-2" },
    });

    expect(record).toEqual({ id: "session-2" });
    expect(firstClient.$disconnect).toHaveBeenCalledTimes(1);
    expect(firstPool.end).toHaveBeenCalledTimes(1);
    expect(secondClient.authSession.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: "hash-2" },
    });
  });

  it("keeps retrying across multiple reconnect attempts before succeeding", async () => {
    const firstClient = createClient();
    const secondClient = createClient();
    const thirdClient = createClient();
    const firstPool = createPool();
    const secondPool = createPool();
    const thirdPool = createPool();

    firstClient.authSession.findUnique.mockRejectedValueOnce(
      new PrismaClientKnownRequestError("Server has closed the connection.", {
        code: "P1017",
      }),
    );
    secondClient.authSession.findUnique.mockRejectedValueOnce(
      new Error("socket closed unexpectedly"),
    );
    thirdClient.authSession.findUnique.mockResolvedValueOnce({ id: "session-3" });

    clientQueue.push(firstClient, secondClient, thirdClient);
    poolQueue.push(firstPool, secondPool, thirdPool);

    const { withPrismaReconnect } = await import("../db");
    const record = await withPrismaReconnect((client) =>
      client.authSession.findUnique({ where: { tokenHash: "hash-3" } }),
    );

    expect(record).toEqual({ id: "session-3" });
    expect(firstClient.$disconnect).toHaveBeenCalledTimes(1);
    expect(secondClient.$disconnect).toHaveBeenCalledTimes(1);
    expect(firstPool.end).toHaveBeenCalledTimes(1);
    expect(secondPool.end).toHaveBeenCalledTimes(1);
    expect(thirdClient.authSession.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: "hash-3" },
    });
  });
});
