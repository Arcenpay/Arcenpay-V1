import { describe, expect, it, vi, afterEach } from "vitest";
import { LocalObjectStore } from "../../../src/lib/storage/local-store.js";
import { R2ObjectStore } from "../../../src/lib/storage/r2-store.js";
import { StorageError } from "../../../src/lib/storage/types.js";

describe("LocalObjectStore", () => {
  it("writes, reads and deletes objects under the base dir", async () => {
    const store = new LocalObjectStore("/tmp/arcenpay-objectstore-test");
    const key = "assets/team-1/logo.png";
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

    expect((await store.get(key))).toBeNull();
    await store.put(key, bytes, { contentType: "image/png" });
    expect(await store.get(key)).toEqual(bytes);
    expect(store.driver).toBe("local");

    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    // idempotent delete
    await store.delete(key);
  });

  it("rejects path traversal keys", async () => {
    const store = new LocalObjectStore("/tmp/arcenpay-objectstore-test");
    await expect(store.put("../escape.png", Buffer.from("x"))).rejects.toThrow();
  });
});

describe("R2ObjectStore", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws a clear error when R2 config is missing", () => {
    expect(
      () => new R2ObjectStore({ accountId: "", accessKeyId: "", secretAccessKey: "", bucket: "" }),
    ).toThrow(StorageError);
  });

  it("rejects a bucket that is actually an endpoint URL", () => {
    expect(
      () =>
        new R2ObjectStore({
          accountId: "0123456789abcd",
          accessKeyId: "akid",
          secretAccessKey: "sekret",
          bucket: "https://0123456789abcd.r2.cloudflarestorage.com",
        }),
    ).toThrow(StorageError);
    expect(
      () =>
        new R2ObjectStore({
          accountId: "0123456789abcd",
          accessKeyId: "akid",
          secretAccessKey: "sekret",
          bucket: "s3://some-bucket",
        }),
    ).toThrow(/bucket name/i);
  });

  it("PUT / GET / DELETE against the R2 path-style endpoint", async () => {
    const store = new R2ObjectStore({
      accountId: "0123456789abcd",
      accessKeyId: "akid",
      secretAccessKey: "sekret",
      bucket: "arcenpay-dev",
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      expect(url.origin).toBe("https://0123456789abcd.r2.cloudflarestorage.com");
      expect(url.pathname).toBe("/arcenpay-dev/assets/team-1/logo.png");
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=akid\//);
      expect(headers?.["x-amz-date"]).toMatch(/^\d{8}T/);
      if (method === "PUT") {
        return new Response(null, { status: 200 });
      }
      if (method === "GET") {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await store.put("assets/team-1/logo.png", bytes, { contentType: "image/png" });
    expect(await store.get("assets/team-1/logo.png")).toEqual(bytes);
    await store.delete("assets/team-1/logo.png");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maps GET 404 to null", async () => {
    const store = new R2ObjectStore({
      accountId: "0123456789abcd",
      accessKeyId: "akid",
      secretAccessKey: "sekret",
      bucket: "arcenpay-dev",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    expect(await store.get("assets/team-1/missing.png")).toBeNull();
  });

  it("surfaces R2 failures as StorageError", async () => {
    const store = new R2ObjectStore({
      accountId: "0123456789abcd",
      accessKeyId: "akid",
      secretAccessKey: "sekret",
      bucket: "arcenpay-dev",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    await expect(store.put("assets/team-1/x.png", Buffer.from("x"))).rejects.toThrow(StorageError);
  });
});
