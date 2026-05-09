import { afterEach, describe, expect, it } from "vitest";
import {
  ARCENPAY_LOCAL_APP_URL,
  ARCENPAY_PRODUCTION_APP_URL,
  resolveArcenPayBaseUrl,
} from "../src/app-origin";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  delete process.env.ARCENPAY_BASE_URL;
  delete process.env.NEXT_PUBLIC_ARCENPAY_BASE_URL;
});

describe("app origin helpers", () => {
  it("prefers an explicit base URL", () => {
    expect(
      resolveArcenPayBaseUrl({
        explicit: "https://custom.arcenpay.com/",
      }),
    ).toBe("https://custom.arcenpay.com");
  });

  it("uses env overrides before runtime defaults", () => {
    process.env.ARCENPAY_BASE_URL = "https://staging.arcenpay.com/";
    expect(resolveArcenPayBaseUrl()).toBe("https://staging.arcenpay.com");
  });

  it("defaults to localhost during local development and tests", () => {
    process.env.NODE_ENV = "test";
    expect(resolveArcenPayBaseUrl()).toBe(ARCENPAY_LOCAL_APP_URL);
  });

  it("defaults to app.arcenpay.com in production", () => {
    process.env.NODE_ENV = "production";
    expect(resolveArcenPayBaseUrl()).toBe(ARCENPAY_PRODUCTION_APP_URL);
  });
});
