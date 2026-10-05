import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createMcpWellKnownRoutes } from "../../src/mcp/well-known.js";

function appWith(token: string) {
  return new Hono().route(
    "/.well-known",
    createMcpWellKnownRoutes(() => token),
  );
}

describe("MCP well-known domain-challenge route", () => {
  it("serves the challenge token verbatim as plain text", async () => {
    const res = await appWith("challenge-abc-123").request(
      "http://localhost/.well-known/openai-apps-challenge",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("challenge-abc-123");
  });

  it("returns 404 when no token is configured", async () => {
    const res = await appWith("").request(
      "http://localhost/.well-known/openai-apps-challenge",
    );
    expect(res.status).toBe(404);
  });
});
