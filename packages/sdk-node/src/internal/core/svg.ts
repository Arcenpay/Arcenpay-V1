/**
 * Lightweight SVG sanitization for defense-in-depth.
 * Strips scripts, event handlers, and javascript: URLs.
 * This is NOT a full HTML sanitizer — it is scoped to SVG strings
 * from provider-configured feature icons.
 */
export function sanitizeSvg(svg: string | null | undefined): string {
  if (!svg) return "";

  // Remove <script> tags and their contents
  let cleaned = svg.replace(/<script[\s\S]*?>?[\s\S]*?<\/script>/gi, "");

  // Remove all on* event attributes (onload, onclick, onerror, etc.)
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^>\s]+)/gi, "");

  // Remove javascript: URLs in href / xlink:href / data attributes
  cleaned = cleaned.replace(/(href|xlink:href|data-[\w-]+)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^>\s]+)/gi, "");

  // Remove any remaining javascript: protocols (case-insensitive)
  cleaned = cleaned.replace(/javascript:/gi, "");

  return cleaned;
}
