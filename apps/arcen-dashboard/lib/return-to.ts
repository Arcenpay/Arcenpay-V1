/**
 * Validates a post-login return URL so login can hand control back to the
 * originating flow (e.g. the MCP OAuth `authorize` URL) without becoming an
 * open redirector.
 *
 * Allowed:
 *   - same-origin relative paths ("/foo", but NOT "//evil.com")
 *   - absolute http(s) URLs on ArcenPay-owned hosts (and localhost for dev)
 */
const ALLOWED_RETURN_HOSTS = new Set([
  "arcenpay.com",
  "www.arcenpay.com",
  "app.arcenpay.com",
  "api.arcenpay.com",
  "docs.arcenpay.com",
  "localhost",
  "127.0.0.1",
]);

export function resolveReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Relative path — reject protocol-relative ("//host") which is cross-origin.
  if (trimmed.startsWith("/")) {
    return trimmed.startsWith("//") ? null : trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!ALLOWED_RETURN_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
