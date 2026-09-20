/**
 * SVG sanitization for provider-configured feature icons.
 *
 * SECURITY — WHY THIS IS NOT A REGEX FILTER
 * ------------------------------------------
 * A regex "sanitizer" is not a security boundary, because the regex sees the
 * raw source text while the browser sees the *parsed* DOM. Two trivially
 * exploitable consequences:
 *
 *   1. Entity decoding: `<a xlink:href="javas&#99;ript:alert(1)">` does not
 *      contain the literal substring `javascript:`, so no amount of
 *      `replace(/javascript:/gi, "")` catches it — but the HTML parser decodes
 *      `&#99;` into `c` and yields a working `javascript:` URL.
 *   2. Double substitution: stripping `javascript:` once turns
 *      `javajavascript:script:alert(1)` INTO `javascript:alert(1)`. The
 *      sanitizer manufactures the payload.
 *
 * This implementation parses the markup with the platform XML/HTML parser and
 * then walks the resulting tree applying a strict element/attribute ALLOW-LIST,
 * discarding everything else. Because decisions are made on parsed nodes,
 * entity encoding and nested/obfuscated constructs cannot bypass it.
 *
 * It also FAILS CLOSED: if no DOM parser is available (server rendering
 * without jsdom) it returns an empty string rather than passing raw markup
 * through. Callers that need an icon during SSR should sanitize after mount.
 */

/** Elements permitted inside a provider feature icon. */
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "symbol",
  "pattern",
]);

/**
 * Elements that can execute script, load remote content, or trigger behaviour.
 * They are rejected outright (and, being absent from the allow-list, would be
 * dropped anyway — this set exists to make the intent explicit and to allow
 * a fast rejection of the whole document).
 */
const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "style",
  "foreignobject",
  "iframe",
  "embed",
  "object",
  "audio",
  "video",
  "use",
  "image",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "handler",
  "listener",
]);

/** Attributes permitted on allowed elements. */
const ALLOWED_ATTRIBUTES = new Set([
  "viewbox",
  "xmlns",
  "xmlns:xlink",
  "width",
  "height",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "opacity",
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "points",
  "transform",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "patternunits",
  "class",
  "id",
  "text-anchor",
  "font-size",
  "font-weight",
  "font-family",
  "dominant-baseline",
  "clip-path",
  "mask",
  "preserveaspectratio",
]);

/**
 * Attributes whose VALUE must be validated rather than merely allow-listed:
 * any URL-bearing attribute is restricted to same-document fragments (`#id`),
 * which cannot navigate or execute.
 */
const URL_ATTRIBUTES = new Set(["href", "xlink:href"]);

function isUrlAttribute(name: string): boolean {
  return URL_ATTRIBUTES.has(name) || name.endsWith(":href");
}

/** Rejects `javascript:`, `data:`, protocol-relative, and absolute URLs. */
function isSafeUrlValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) return true;
  // Allow local `url(#gradient)` references inside style-like attributes.
  return /^url\(\s*#[A-Za-z0-9_-]+\s*\)$/.test(trimmed);
}

function sanitizeElement(element: Element, doc: Document): void {
  const children = Array.from(element.children);
  for (const child of children) {
    const tag = child.tagName.toLowerCase();

    if (FORBIDDEN_ELEMENTS.has(tag) || !ALLOWED_ELEMENTS.has(tag)) {
      child.remove();
      continue;
    }

    const attributes = Array.from(child.attributes);
    for (const attribute of attributes) {
      const name = attribute.name.toLowerCase();

      // Any `on*` handler is rejected by name (covers unlisted vendor events).
      if (name.startsWith("on")) {
        child.removeAttribute(attribute.name);
        continue;
      }

      if (isUrlAttribute(name)) {
        if (!isSafeUrlValue(attribute.value)) {
          child.removeAttribute(attribute.name);
        }
        continue;
      }

      if (!ALLOWED_ATTRIBUTES.has(name)) {
        child.removeAttribute(attribute.name);
      }
    }

    sanitizeElement(child, doc);
  }
}

export function sanitizeSvg(svg: string | null | undefined): string {
  if (!svg || typeof svg !== "string") return "";
  // Bound the input so a giant document cannot be used to burn CPU.
  if (svg.length > 64 * 1024) return "";

  const DOMParserCtor =
    typeof globalThis.DOMParser !== "undefined"
      ? globalThis.DOMParser
      : undefined;

  // FAIL CLOSED: without a parser we cannot make a trustworthy decision, so we
  // emit nothing rather than risk passing hostile markup through.
  if (!DOMParserCtor) return "";

  let doc: Document;
  try {
    const parser = new DOMParserCtor();
    doc = parser.parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
      "image/svg+xml",
    );
  } catch {
    return "";
  }

  // A parse error yields a <parsererror> document — reject rather than guess.
  if (
    doc.getElementsByTagName("parsererror").length > 0 ||
    doc.getElementsByTagName("parsererror-ns").length > 0
  ) {
    return "";
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") return "";

  sanitizeElement(root, doc);

  return root.innerHTML;
}

