"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs/legacy";
import { EyeOff, Loader2 } from "lucide-react";
import { getClerkErrorMessage } from "@/components/auth/clerk-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignInForm() {
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const handlePasswordSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isLoaded) return;

    setIsLoading(true);
    setAuthError("");

    try {
      const result = await signIn.create({
        identifier: email,
        password,
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.push("/");
        router.refresh();
        return;
      }

      setAuthError("Additional verification is required for this account.");
    } catch (error: unknown) {
      setAuthError(getClerkErrorMessage(error, "Unable to sign in."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOauth = async (strategy: "oauth_google" | "oauth_github") => {
    if (!isLoaded) return;

    setIsLoading(true);
    setAuthError("");

    try {
      await signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/",
      });
    } catch (error: unknown) {
      setAuthError(getClerkErrorMessage(error, "Could not continue with SSO."));
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handlePasswordSignIn} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-[#111320]/88">Email</label>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="you@company.com"
            className="h-12 rounded-xl border-[#111320]/14 bg-white px-4 text-[16px]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-[#111320]/88">Password</label>
          <div className="relative">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Enter password"
              className="h-12 rounded-xl border-[#111320]/14 bg-white px-4 pr-10 text-[16px]"
            />
            <EyeOff className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#111320]/35" />
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <label className="inline-flex items-center gap-2 text-[#111320]/60">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-4 w-4 rounded border border-[#111320]/25 accent-[rgb(62,67,255)]"
            />
            Remember Me
          </label>
          <button type="button" className="font-medium text-[rgb(62,67,255)]">
            Forgot Your Password?
          </button>
        </div>

        {authError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {authError}
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={!isLoaded || isLoading}
          className="h-12 w-full rounded-xl bg-[linear-gradient(90deg,#3f45ff,#2f36e8)] text-base font-medium text-white hover:opacity-95"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Logging in
            </>
          ) : (
            "Log In"
          )}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[#111320]/16" />
        <span className="text-sm text-[#111320]/52">Or Login With</span>
        <div className="h-px flex-1 bg-[#111320]/16" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleOauth("oauth_google")}
          disabled={!isLoaded || isLoading}
          className="h-12 rounded-xl border-[#111320]/14 bg-white text-[16px] text-[#111320] hover:bg-[#f6f7fd]"
        >
          Google
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleOauth("oauth_github")}
          disabled={!isLoaded || isLoading}
          className="h-12 rounded-xl border-[#111320]/14 bg-white text-[16px] text-[#111320] hover:bg-[#f6f7fd]"
        >
          GitHub
        </Button>
      </div>

      <p className="pt-2 text-center text-base text-[#111320]/58">
        Don&apos;t Have An Account?{" "}
        <Link href="/sign-up" className="font-semibold text-[rgb(62,67,255)]">
          Register Now.
        </Link>
      </p>
    </div>
  );
}
