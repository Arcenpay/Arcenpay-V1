"use client";
import { apiFetch } from "@/lib/api-client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

type InviteStatus =
  | { state: "loading" }
  | { state: "success"; teamName: string; teamSlug: string; needsWallet: boolean }
  | { state: "error"; message: string }
  | { state: "email_mismatch"; invitedEmail: string; currentEmail: string };

export default function AcceptInvitePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<InviteStatus>({ state: "loading" });
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!token) {
      setStatus({ state: "error", message: "No invitation token provided." });
      return;
    }

    startTransition(async () => {
      try {
        const response = await apiFetch("/api/team/invite/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (response.status === 401) {
            router.push(`/login?invite=${encodeURIComponent(token)}`);
            return;
          }

          if (response.status === 409 && payload.invitedEmail) {
            setStatus({
              state: "email_mismatch",
              invitedEmail: payload.invitedEmail,
              currentEmail: payload.currentEmail ?? "",
            });
            return;
          }

          setStatus({
            state: "error",
            message: payload.error || "Could not accept this invitation.",
          });
          return;
        }

        setStatus({
          state: "success",
          teamName: payload.teamName ?? "Workspace",
          teamSlug: payload.teamSlug ?? "",
          needsWallet: payload.needsWallet ?? false,
        });
      } catch {
        setStatus({
          state: "error",
          message: "Something went wrong. Please try again.",
        });
      }
    });
  }, [token, router]);

  useEffect(() => {
    if (status.state === "success") {
      const redirectTo = status.needsWallet ? "/onboarding/chain" : "/";
      const timeout = setTimeout(() => {
        router.push(redirectTo);
        router.refresh();
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [status.state, router]);

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-8 flex items-center justify-center">
            <Image
              src="/arcenpay-logo.png"
              alt="ArcenPay"
              width={168}
              height={40}
              className="h-10 w-auto object-contain dark:brightness-0 dark:invert"
              priority
            />
          </div>

          <div className="space-y-6 text-center">
            {status.state === "loading" && (
              <>
                <div className="flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Accepting workspace invitation...
                </p>
              </>
            )}

            {status.state === "success" && (
              <>
                <div className="flex items-center justify-center">
                  <CheckCircle2 className="h-10 w-10 text-brand" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-foreground">
                    Invitation accepted
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    You&apos;ve joined <strong>{status.teamName}</strong>.
                    Redirecting to your dashboard...
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    router.push(status.needsWallet ? "/onboarding/chain" : "/");
                    router.refresh();
                  }}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Go to dashboard now
                </button>
              </>
            )}

            {status.state === "error" && (
              <>
                <div className="flex items-center justify-center">
                  <XCircle className="h-10 w-10 text-red-500" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-foreground">
                    Invitation error
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {status.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Back to dashboard
                </button>
              </>
            )}

            {status.state === "email_mismatch" && (
              <>
                <div className="flex items-center justify-center">
                  <XCircle className="h-10 w-10 text-amber-500" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-foreground">
                    Email mismatch
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This invitation was sent to{" "}
                    <strong>{status.invitedEmail}</strong>, but you&apos;re
                    signed in as <strong>{status.currentEmail}</strong>.
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sign out and sign in with the invited email address to join the workspace.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
                      router.push("/login?invite=" + encodeURIComponent(token ?? ""));
                    }}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Sign out and sign in with invited email
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/")}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    Back to dashboard
                  </button>
                </div>
              </>
            )}
          </div>

          </div>
      </div>
    </div>
  );
}
