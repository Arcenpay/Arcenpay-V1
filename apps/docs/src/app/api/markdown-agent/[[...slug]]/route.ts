import { NextRequest, NextResponse } from "next/server";
import { estimateMarkdownTokens, htmlToMarkdownDocument } from "@/lib/markdown";

const MARKDOWN_BYPASS_PARAM = "__markdown_bypass";
const PUBLIC_DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? "";

function resolveDocsPath(
  request: NextRequest,
  params: { slug?: string[] },
): string | null {
  const queryPath = request.nextUrl.searchParams.get("path")?.trim();
  if (queryPath?.startsWith("/")) {
    return queryPath;
  }

  const slug = params.slug ?? [];
  if (slug.length === 0) {
    return null;
  }

  if (slug.length === 1 && slug[0] === "__index") {
    return "/";
  }

  return `/${slug.join("/")}`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  const params = await context.params;
  const path = resolveDocsPath(request, params);

  if (!path || !path.startsWith("/")) {
    return NextResponse.json(
      { error: "A docs path is required." },
      { status: 400 },
    );
  }

  const sourceUrl = new URL(path, request.nextUrl.origin);
  sourceUrl.searchParams.set(MARKDOWN_BYPASS_PARAM, "1");

  const upstream = await fetch(sourceUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });

  if (!upstream.ok) {
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const html = await upstream.text();
  const canonicalUrl = PUBLIC_DOCS_URL
    ? new URL(path, PUBLIC_DOCS_URL).toString()
    : sourceUrl.toString();
  const markdown = htmlToMarkdownDocument(html, canonicalUrl);

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Signal": "ai-train=yes, search=yes, ai-input=yes",
      Vary: "Accept",
      "X-Markdown-Tokens": String(estimateMarkdownTokens(markdown)),
      "X-Markdown-Source": path,
    },
  });
}
