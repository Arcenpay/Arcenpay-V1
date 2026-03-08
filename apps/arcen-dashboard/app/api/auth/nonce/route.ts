import { NextRequest, NextResponse } from "next/server";
import { generateNonce } from "@/lib/nonce.server";
import { rateLimit, applyRateLimitHeaders } from "@/lib/rate-limit";

// 20 nonce requests per IP per minute — prevents brute-force SIWE replay farming
const NONCE_LIMIT = 20;
const NONCE_WINDOW_MS = 60_000;

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const result = rateLimit(`nonce:${ip}`, NONCE_LIMIT, NONCE_WINDOW_MS);
  if (!result.ok) {
    const res = NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
    applyRateLimitHeaders(res.headers, result, NONCE_LIMIT);
    return res;
  }

  const nonce = await generateNonce();
  const res = NextResponse.json(nonce);
  applyRateLimitHeaders(res.headers, result, NONCE_LIMIT);
  return res;
}
