import { createHash, createHmac } from "crypto";

/**
 * AWS Signature Version 4 signing for S3-compatible endpoints (Cloudflare R2).
 *
 * Pure HMAC-SHA256 implementation matching the official AWS SigV4 algorithm
 * (validated against the published AWS test vector). No SDK required.
 *
 * R2 specifics: endpoint is `https://<accountId>.r2.cloudflarestorage.com`,
 * the region is `auto` and buckets use path-style addressing.
 */

export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function hexSha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

export interface SignV4Input {
  method: "GET" | "PUT" | "DELETE" | "POST" | "HEAD";
  /** URL-encoded resource path (e.g. "/bucket/folder/file.png"). */
  path: string;
  /** Raw query params (sorted internally). */
  query?: Record<string, string>;
  /** Headers to sign: keys must be lowercase; include `host` and any
   *  x-amz-* / content-* headers. `x-amz-date` and
   *  `x-amz-content-sha256` are added automatically if absent. */
  headers?: Record<string, string>;
  body?: Buffer;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  service?: string;
  /** Overridable for deterministic tests. */
  date?: Date;
}

export interface SignV4Result {
  authorization: string;
  xAmzDate: string;
  xAmzContentSha256: string;
}

export function signV4(input: SignV4Input): SignV4Result {
  const region = input.region ?? "auto";
  const service = input.service ?? "s3";
  const date = input.date ?? new Date();
  const amzDate = date
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);

  const body = input.body ?? Buffer.alloc(0);
  const payloadHash = hexSha256(body);

  // 1. Canonical request
  const queryEntries = Object.entries(input.query ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  const headers: Record<string, string> = {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    ),
  };
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders =
    sortedKeys.map((key) => `${key}:${String(headers[key]).trim()}`).join("\n") + "\n";
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [
    input.method,
    input.path,
    queryEntries,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // 2. String to sign
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    hexSha256(Buffer.from(canonicalRequest, "utf8")),
  ].join("\n");

  // 3. Signing key + signature
  const kDate = hmac("AWS4" + input.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  return {
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    xAmzDate: amzDate,
    xAmzContentSha256: payloadHash,
  };
}
