/**
 * SSRF guard for outbound requests to user-supplied URLs (webhooks, test
 * deliveries, agent dispatch).
 *
 * WHY: a team OWNER/ADMIN controls the webhook URL, and the server fetches it.
 * Without a guard, `https://169.254.169.254/…` (cloud metadata) or any internal
 * HTTPS service becomes a request the server makes on the attacker's behalf.
 *
 * WHAT IT CHECKS:
 *  - scheme is https, no embedded credentials,
 *  - port is https-default (or an explicit allow-list),
 *  - hostname is not a known-internal name,
 *  - the hostname does NOT resolve (A or AAAA) to a loopback/private/link-local/
 *    ULA/CGNAT/reserved/multicast address.
 *
 * LIMITATION: this validates the resolved address, but `fetch` re-resolves at
 * connect time, leaving a narrow DNS-rebinding (TOCTOU) window. Closing it
 * fully would require pinning the socket to the validated IP, which `fetch`
 * does not expose. The host allow-list controls below make exploitation of that
 * window materially harder and are the standard mitigation at this layer.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type SafeOutboundUrl =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

const DEFAULT_ALLOWED_PORTS = new Set([443]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

function isBlockedHostnameSuffix(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home.arpa")
  );
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0) return true; // 192.0.0/24, 192.0.2/24 reserved
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped (::ffff:1.2.3.4) → validate the embedded v4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  if (lower === "::" || lower === "::1") return true; // unspecified / loopback
  if (lower.startsWith("fe80")) return true; // link-local fe80::/10
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("ff")) return true; // multicast ff00::/8
  if (lower.startsWith("64:ff9b:")) return true; // NAT64
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true; // unknown shape → unsafe
}

export interface AssertSafeOutboundUrlOptions {
  /** Override the permitted ports. Defaults to HTTPS only ({443}). */
  allowedPorts?: Set<number>;
  /** Extra hostnames to allow even if they resolve privately (exact match). */
  allowHosts?: Set<string>;
}

/**
 * Validates that a user-supplied URL is safe to fetch server-side. Returns
 * `{ ok: true, url }` on success, or `{ ok: false, reason }` describing why the
 * URL was rejected.
 */
export async function assertSafeOutboundUrl(
  raw: string,
  options: AssertSafeOutboundUrlOptions = {},
): Promise<SafeOutboundUrl> {
  const allowedPorts = options.allowedPorts ?? DEFAULT_ALLOWED_PORTS;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL is not valid" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "Only https:// URLs are allowed" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed" };
  }

  const port = url.port ? Number(url.port) : 443;
  if (!allowedPorts.has(port)) {
    return { ok: false, reason: `Port ${port} is not allowed` };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (options.allowHosts?.has(hostname)) {
    return { ok: true, url };
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || isBlockedHostnameSuffix(hostname)) {
    return { ok: false, reason: "URL host is not allowed" };
  }

  // A literal IP needs no DNS; validate it directly.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      return { ok: false, reason: "URL resolves to a private address" };
    }
    return { ok: true, url };
  }

  // Resolve every address and reject if any is private.
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) {
      return { ok: false, reason: "URL host did not resolve" };
    }
    for (const entry of addresses) {
      if (isPrivateAddress(entry.address)) {
        return { ok: false, reason: "URL resolves to a private address" };
      }
    }
  } catch {
    return { ok: false, reason: "URL host did not resolve" };
  }

  return { ok: true, url };
}
