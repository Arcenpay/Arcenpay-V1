import type { Context } from "hono";
import { isValidAnyFamilyAddress } from "@arcenpay/internal-core";
import { resolveSession } from "../../../middleware/auth.js";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "../../../config.js";

/**
 * Family-agnostic wallet equality: EVM hex is case-insensitive, but Solana
 * base58 / Stellar base32 are case-sensitive and must be compared verbatim.
 */
function walletsEqual(a: string, b: string): boolean {
  if (a.startsWith("0x") && b.startsWith("0x")) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

async function forwardRequest(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  c: Context,
) {
  const session = await resolveSession(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401 as any);
  }

  if (!session.walletAddress) {
    return c.json({ error: "Unauthorized" }, 401 as any);
  }

  const provider = c.req.param("provider");
  const segmentsParam = c.req.param("segments");

  // Preserve case: lowercasing a Solana base58 address corrupts it.
  const normalizedProvider = String(provider || "").trim();
  if (!isValidAnyFamilyAddress(normalizedProvider)) {
    return c.json({ error: "Invalid provider address" }, 400 as any);
  }

  if (!walletsEqual(session.walletAddress, normalizedProvider)) {
    return c.json({ error: "Forbidden" }, 403 as any);
  }

  const segments = segmentsParam ? segmentsParam.split("/").map((s) => decodeURIComponent(s)) : [];
  const encodedSegments = segments.map((segment) => encodeURIComponent(segment));
  const pathSuffix =
    encodedSegments.length > 0 ? `/${encodedSegments.join("/")}` : "";

  const url = new URL(c.req.url);
  const targetUrl = `${FACILITATOR_URL}/api/entitlements/provider/${normalizedProvider}/flags${pathSuffix}${url.search}`;

  if (method === "POST" && segments[0] !== "bootstrap") {
    return c.json({ error: "Not Found" }, 404 as any);
  }

  const bodyText =
    method === "GET" || method === "DELETE" ? undefined : await c.req.json().then(JSON.stringify);

  const upstream = await fetch(targetUrl, {
    method,
    headers: {
      Accept: "application/json",
      ...(bodyText
        ? {
            "Content-Type":
              c.req.header("content-type") || "application/json",
          }
        : {}),
      ...(FACILITATOR_SECRET
        ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
        : {}),
    },
    ...(bodyText ? { body: bodyText } : {}),
  });

  const contentType = upstream.headers.get("content-type");
  const text = await upstream.text();

  return new Response(text, {
    status: upstream.status,
    headers: contentType ? { "content-type": contentType } : {},
  });
}

export async function handleProviderFlags(c: Context): Promise<Response> {
  return forwardRequest(c.req.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE", c);
}
