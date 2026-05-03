const ABSOLUTE_URL_PATTERN = /^(?:[a-z]+:)?\/\//i;

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}

function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]+>/g, " "));
}

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function resolveHref(href: string, origin: string) {
  if (!href) return "";
  if (ABSOLUTE_URL_PATTERN.test(href)) return href;
  if (href.startsWith("#")) return href;
  return new URL(href, origin).toString();
}

function convertLinks(input: string, origin: string) {
  return input.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, label: string) => {
      const text = normalizeWhitespace(stripTags(label));
      const url = resolveHref(href, origin);
      if (!text) return url;
      if (!url) return text;
      return `[${text}](${url})`;
    },
  );
}

function convertTable(tableHtml: string, origin: string) {
  const rows = Array.from(tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map(
    (match) => match[1],
  );
  if (rows.length === 0) return "";

  const parsedRows = rows
    .map((row) =>
      Array.from(row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)).map((cell) =>
        normalizeWhitespace(stripTags(convertLinks(cell[1], origin))),
      ),
    )
    .filter((row) => row.length > 0);

  if (parsedRows.length === 0) return "";

  const header = parsedRows[0];
  const divider = header.map(() => "---");
  const body = parsedRows.slice(1);

  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];

  return `\n\n${lines.join("\n")}\n\n`;
}

function extractMainContent(html: string) {
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1];

  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return mainMatch[1];

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch?.[1] ?? html;
}

export function estimateMarkdownTokens(markdown: string) {
  return Math.max(1, Math.ceil(markdown.length / 4));
}

export function htmlToMarkdownDocument(html: string, url: string) {
  const origin = new URL(url).origin;
  const rawTitle = decodeEntities(
    html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "ArcenPay Docs",
  );
  const firstHeading = normalizeWhitespace(
    stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""),
  );
  const title =
    rawTitle === "ArcenPay Docs" && firstHeading ? firstHeading : rawTitle;
  const description = decodeEntities(
    html
      .match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1]
      ?.trim() ?? "",
  );

  let content = extractMainContent(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<span\b[^>]*docs-callout-icon[^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const blocks: string[] = [];
  const placeholders = new Map<string, string>();
  let blockIndex = 0;

  const store = (value: string) => {
    const key = `__MARKDOWN_BLOCK_${blockIndex++}__`;
    placeholders.set(key, value);
    return key;
  };

  content = content.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) =>
    store(convertTable(table, origin)),
  );

  content = content.replace(
    /<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, code: string) =>
      store(`\n\n\`\`\`\n${decodeEntities(code).trim()}\n\`\`\`\n\n`),
  );

  content = convertLinks(content, origin);
  content = content.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, code: string) => {
    const value = decodeEntities(stripTags(code)).trim();
    return value ? ` \`${value}\` ` : "";
  });

  content = content
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, text: string) => `\n\n# ${normalizeWhitespace(stripTags(text))}\n\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, text: string) => `\n\n## ${normalizeWhitespace(stripTags(text))}\n\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, text: string) => `\n\n### ${normalizeWhitespace(stripTags(text))}\n\n`)
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, text: string) => `\n\n#### ${normalizeWhitespace(stripTags(text))}\n\n`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text: string) => {
      const body = normalizeWhitespace(stripTags(text))
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `\n\n${body}\n\n`;
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, text: string) => `- ${normalizeWhitespace(stripTags(text))}\n`)
    .replace(/<\/(?:ul|ol)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p\b[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<div\b[^>]*>/gi, "")
    .replace(/<\/section>/gi, "\n")
    .replace(/<section\b[^>]*>/gi, "")
    .replace(/<hr\b[^>]*\/?>/gi, "\n\n---\n\n")
    .replace(/<(?:span|strong|em|b|i|small)[^>]*>/gi, "")
    .replace(/<\/(?:span|strong|em|b|i|small)>/gi, "");

  content = normalizeWhitespace(stripTags(content));

  for (const [key, value] of placeholders.entries()) {
    content = content.replace(key, value.trim());
  }

  const frontmatter = [
    "---",
    `title: ${title}`,
    `source: ${url}`,
    ...(description ? [`description: ${description}`] : []),
    "---",
    "",
  ];

  const body = normalizeWhitespace(content);
  blocks.push(frontmatter.join("\n"));
  blocks.push(body);

  return `${blocks.join("\n")}\n`;
}
