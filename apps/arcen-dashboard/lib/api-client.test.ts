import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api-client";

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends browser API requests directly to the configured backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/auth/session");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3300/api/v1/auth/session",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
