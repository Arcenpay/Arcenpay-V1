import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("dashboard API proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards a backend session cookie to the dashboard origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
          "set-cookie": "arcen_session=session-token; Path=/; HttpOnly; Secure; SameSite=None; Domain=.arcenpay.com",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("https://app.arcenpay.com/api/auth/email/verify"),
    );

    expect(response.headers.get("set-cookie")).toContain(
      "arcen_session=session-token",
    );
  });
});
