import { NextResponse } from "next/server";
import { ALL_DOCS_NAV_ITEMS, DOCS_NAV_GROUPS } from "@/lib/docs-nav";

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.arcenpay.xyz";

function absoluteUrl(path: string) {
  return new URL(path, DOCS_URL).toString();
}

const LLMS_CONTENT = [
  "# ArcenPay Docs",
  "",
  "> Developer documentation for integrating ArcenPay checkout, embedded billing surfaces, entitlements, and agent payments.",
  "",
  "## For AI agents",
  `- Docs index: ${absoluteUrl("/")}`,
  `- Sitemap: ${absoluteUrl("/sitemap.xml")}`,
  "- Every docs page can be requested as markdown by sending `Accept: text/markdown` to the normal page URL.",
  "- Fallback explicit markdown endpoint: `/api/markdown-agent/<docs path>` (example: `/api/markdown-agent/sdk-reference`).",
  "- Markdown responses include `Content-Type: text/markdown`, `Vary: Accept`, and `X-Markdown-Tokens`.",
  "",
  ...DOCS_NAV_GROUPS.flatMap((group) => [
    `## ${group.label}`,
    ...group.items.map((item) => {
      const description = item.description ? ` — ${item.description}` : "";
      return `- ${item.label}: ${absoluteUrl(item.href)}${description}`;
    }),
    "",
  ]),
  "## Direct Markdown Examples",
  ...ALL_DOCS_NAV_ITEMS.slice(0, 6).map(
    (item) => `- ${item.label}: curl -H "Accept: text/markdown" ${absoluteUrl(item.href)}`,
  ),
  "",
].join("\n");

export async function GET() {
  return new NextResponse(LLMS_CONTENT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Signal": "ai-train=yes, search=yes, ai-input=yes",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
