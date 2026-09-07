import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_COOKIE_NAME } from "./auth-constants";
import { proxy } from "../proxy";

describe("dashboard proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("clears only the legacy host-only cookie during production onboarding", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest(
      "https://app.arcenpay.com/onboarding/provider-profile",
      { headers: { cookie: `${AUTH_COOKIE_NAME}=active-session` } },
    );

    const response = proxy(request);

    expect(response.headers.get("set-cookie")).toContain(
      `${AUTH_COOKIE_NAME}=; Path=/;`,
    );
    expect(response.headers.get("set-cookie")).not.toContain("Domain=");
  });
});
