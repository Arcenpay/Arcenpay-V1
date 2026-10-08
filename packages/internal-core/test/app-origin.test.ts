import { describe, expect, it } from "vitest";
import {
  ARCENPAY_API_URL,
  ARCENPAY_APP_URL,
  resolveArcenPayAppUrl,
  resolveArcenPayBaseUrl,
} from "../src/app-origin";

describe("app origin helpers", () => {
  it("prefers an explicit base URL", () => {
    expect(
      resolveArcenPayBaseUrl({
        explicit: "https://custom.arcenpay.com/",
      }),
    ).toBe("https://custom.arcenpay.com");
  });

  it("uses the fixed API URL by default", () => {
    expect(resolveArcenPayBaseUrl()).toBe(ARCENPAY_API_URL);
  });

  it("uses the fixed app URL by default", () => {
    expect(resolveArcenPayAppUrl()).toBe(ARCENPAY_APP_URL);
  });
});
