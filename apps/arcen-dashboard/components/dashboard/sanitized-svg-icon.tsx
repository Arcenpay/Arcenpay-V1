"use client";

import { useEffect, useState } from "react";
import { sanitizeSvg } from "@arcenpay/internal-core";
import { cn } from "@/lib/utils";

/**
 * Renders a provider-supplied SVG icon safely.
 *
 * `sanitizeSvg` needs a DOM parser, so it returns an empty string when there is
 * none (during server rendering). Rendering the sanitized markup directly would
 * therefore produce different HTML on the server and on the client, which React
 * flags as a hydration mismatch. Sanitizing in an effect keeps the first client
 * paint identical to the server output and swaps in the icon immediately after.
 *
 * SECURITY: markup only ever reaches `dangerouslySetInnerHTML` AFTER it has been
 * re-parsed and allow-list filtered. There is no path where the raw provider
 * string is injected.
 */
export function SanitizedSvgIcon({
  svg,
  className,
}: {
  svg: string;
  className?: string;
}) {
  const [safeMarkup, setSafeMarkup] = useState("");

  useEffect(() => {
    setSafeMarkup(sanitizeSvg(svg));
  }, [svg]);

  if (!safeMarkup) {
    // Keep the box sized so the layout does not shift once the icon appears.
    return <span className={cn("inline-block h-5 w-5", className)} aria-hidden="true" />;
  }

  return (
    <span
      className={cn("inline-flex [&>svg]:h-5 [&>svg]:w-5", className)}
      dangerouslySetInnerHTML={{ __html: safeMarkup }}
    />
  );
}
