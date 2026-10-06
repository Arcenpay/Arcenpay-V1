"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * One-click OAuth consent screen rendered on the dashboard.
 *
 * "Authorize" navigates to the backend `/oauth/authorize` endpoint from this
 * same-site page, so the session cookie is sent and the authorization code is
 * issued immediately — the user never has to log in again if they already have
 * a dashboard session.
 */
export function OAuthConsent({
  authorizeUrl,
  redirectUri,
  state,
  accountEmail,
}: {
  authorizeUrl: string;
  redirectUri: string;
  state: string;
  accountEmail?: string;
}) {
  const [pending, setPending] = useState(false);

  const approve = () => {
    setPending(true);
    window.location.href = authorizeUrl;
  };

  const deny = () => {
    try {
      const url = new URL(redirectUri);
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("error_description", "The user denied the request");
      if (state) url.searchParams.set("state", state);
      window.location.href = url.toString();
    } catch {
      window.location.href = "/";
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">
          Authorize access
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An application is requesting <strong>read-only</strong> access to your
          ArcenPay account.
        </p>
        {accountEmail ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Signed in as {accountEmail}
          </p>
        ) : null}

        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Companies, plans and add-ons</li>
          <li>Subscriptions and entitlements</li>
          <li>Invoices and payment links</li>
          <li>Agent mandate and settlement status, supported chains</li>
        </ul>

        <p className="mt-4 text-xs text-muted-foreground">
          This app cannot change billing state, start subscriptions, or move
          funds.
        </p>

        <div className="mt-6 flex gap-3">
          <Button
            type="button"
            onClick={approve}
            disabled={pending}
            className="h-11 flex-1 bg-brand hover:bg-brand-dark text-primary-foreground"
          >
            {pending ? "Authorizing…" : "Authorize"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={deny}
            disabled={pending}
            className="h-11 flex-1"
          >
            Cancel
          </Button>
        </div>
      </div>
    </main>
  );
}
