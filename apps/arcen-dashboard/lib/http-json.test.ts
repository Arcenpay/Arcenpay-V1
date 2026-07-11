import { describe, expect, it } from "vitest";
import { HttpResponseError, readJsonOrThrow } from "./http-json";

describe("readJsonOrThrow", () => {
  it("returns parsed JSON for successful responses", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(readJsonOrThrow<{ ok: boolean }>(response)).resolves.toEqual({
      ok: true,
    });
  });

  it("throws a useful error for failed JSON responses", async () => {
    const response = new Response(JSON.stringify({ error: "No environment" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });

    await expect(readJsonOrThrow(response, "Fallback")).rejects.toMatchObject({
      name: "HttpResponseError",
      message: "No environment",
      status: 409,
    } satisfies Partial<HttpResponseError>);
  });

  it("uses the fallback message when an error response has no JSON body", async () => {
    const response = new Response("not json", { status: 500 });

    await expect(readJsonOrThrow(response, "Could not load")).rejects.toThrow(
      "Could not load",
    );
  });
});
