"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile widget.
 *
 * Renders the challenge into a container and reports the token via `onToken`.
 * The token is then sent in the auth request body as `cf-turnstile-response`,
 * which the backend verifies (see `lib/auth/turnstile.ts`).
 *
 * The backend only enforces the challenge when `TURNSTILE_SECRET_KEY` is set, so
 * a deployment without the secret still works — but the dashboard should always
 * render the widget so the two stay in sync (setting only one side 403s).
 */

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
    },
  ) => string;
  remove: (id: string) => void;
  reset: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// A Turnstile sitekey is PUBLIC — Cloudflare expects it embedded in the page
// markup, and anyone can read it from the widget. Keeping the production value
// as a fallback (env still wins) mirrors the hard-coded production fallback used
// for BACKEND_URL in lib/config.ts, and means a missing build-time env var can
// never silently disable bot protection in production. Register
// `localhost`, `127.0.0.1` and `app.arcenpay.com` on the widget so dev and prod
// can share this one key.
const SITE_KEY =
  (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "").trim() ||
  "0x4AAAAAAFTptN-jqOuk1L5a";

export function TurnstileWidget({
  onToken,
  className,
  resetSignal = 0,
}: {
  onToken: (token: string | null) => void;
  className?: string;
  /**
   * Bump this after a submit completes to redeem a fresh token. Turnstile
   * tokens are single-use, so a retry with the previous token is rejected as
   * `timeout-or-duplicate`.
   */
  resetSignal?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => {
          setFailed(true);
          onTokenRef.current(null);
        },
        theme: "auto",
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${SCRIPT_SRC}"]`,
      );
      if (existing) {
        existing.addEventListener("load", renderWidget);
      } else {
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.addEventListener("load", renderWidget);
        script.addEventListener("error", () => setFailed(true));
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // widget already gone
        }
      }
      widgetIdRef.current = null;
    };
  }, []);

  // Redeem a fresh token whenever the parent reports that the previous one was
  // consumed by a request. Skipped on the initial render (resetSignal === 0).
  useEffect(() => {
    if (resetSignal === 0) return;
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // widget already gone — the next mount renders a fresh one
      }
    }
    onTokenRef.current(null);
  }, [resetSignal]);

  if (!SITE_KEY) return null;

  return (
    <div className={className}>
      <div ref={containerRef} />
      {failed ? (
        <p className="text-xs text-destructive">
          Verification challenge failed to load. Please refresh and retry.
        </p>
      ) : null}
    </div>
  );
}
