import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { AUTH_COOKIE_NAME } from "./auth-constants";
import { proxy } from "../proxy";

describe("dashboard proxy", () => {
  it("preserves an authenticated session while a provider completes onboarding", () => {
    const request = new NextRequest(
      "https://app.arcenpay.com/onboarding/provider-profile",
      { headers: { cookie: `${AUTH_COOKIE_NAME}=active-session` } },
    );

    const response = proxy(request);

    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      `${AUTH_COOKIE_NAME}=;`,
    );
  });
});
