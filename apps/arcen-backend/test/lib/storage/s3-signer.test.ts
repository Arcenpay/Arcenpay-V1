import { describe, expect, it } from "vitest";
import { EMPTY_SHA256, signV4 } from "../../../src/lib/storage/s3-signer.js";

// Official AWS SigV4 example: GET Object (see AWS docs "Examples of the
// complete Signature Version 4 signing process").
const ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const FIXED_DATE = new Date("2013-05-24T00:00:00.000Z");

describe("s3 signer (SigV4)", () => {
  it("matches the official AWS GET-object signature", () => {
    const result = signV4({
      method: "GET",
      path: "/test.txt",
      headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9" },
      body: Buffer.alloc(0),
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      region: "us-east-1",
      service: "s3",
      date: FIXED_DATE,
    });
    expect(result.xAmzDate).toBe("20130524T000000Z");
    expect(result.xAmzContentSha256).toBe(EMPTY_SHA256);
    expect(result.authorization).toContain(
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("signs a PUT with a body and content-type (R2 upload shape)", () => {
    const result = signV4({
      method: "PUT",
      path: "/bucket/assets/team-1/logo.png",
      headers: { host: "0123.r2.cloudflarestorage.com", "content-type": "image/png" },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      region: "auto",
      service: "s3",
      date: FIXED_DATE,
    });
    expect(result.authorization).toContain("Credential=test-key/20130524/auto/s3/aws4_request");
    expect(result.authorization).toContain("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date");
    expect(result.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
    // Deterministic across runs.
    const again = signV4({
      method: "PUT",
      path: "/bucket/assets/team-1/logo.png",
      headers: { host: "0123.r2.cloudflarestorage.com", "content-type": "image/png" },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      region: "auto",
      service: "s3",
      date: FIXED_DATE,
    });
    expect(again.authorization).toBe(result.authorization);
  });
});
