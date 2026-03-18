"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignUp } from "@clerk/nextjs/legacy";
import { Loader2 } from "lucide-react";
import { getClerkErrorMessage } from "@/components/auth/clerk-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SignUpStep = "credentials" | "verification";

export function SignUpForm() {
  const router = useRouter();
  const { isLoaded, signUp, setActive } = useSignUp();

  const [step, setStep] = useState<SignUpStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const handleSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isLoaded) return;

    if (password !== confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    setAuthError("");

    try {
      const result = await signUp.create({
        emailAddress: email,
        password,
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.push("/");
        router.refresh();
        return;
      }

      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });
      setStep("verification");
    } catch (error: unknown) {
      setAuthError(getClerkErrorMessage(error, "Unable to create account."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isLoaded) return;

    setIsLoading(true);
    setAuthError("");

    try {
      const result = await signUp.attemptEmailAddressVerification({ code });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.push("/");
        router.refresh();
        return;
      }

      setAuthError("Verification is not complete yet.");
    } catch (error: unknown) {
      setAuthError(getClerkErrorMessage(error, "Invalid verification code."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!isLoaded) return;
    setIsLoading(true);
    setAuthError("");
    try {
      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });
    } catch (error: unknown) {
      setAuthError(getClerkErrorMessage(error, "Could not resend code."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOauth = async (strategy: "oauth_google" | "oauth_github") => {
    if (!isLoaded) return;

    setIsLoading(true);
    setAuthError("");

    try {
      await signUp.authenticateWithRedirect({
        strategy,
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/",
      });
    } catch (error: unknown) {
      setAuthError(getClerkErrorMessage(error, "Could not continue with SSO."));
      setIsLoading(false);
    }
  };

  if (step === "verification") {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-[#111320]/12 bg-white px-4 py-3 text-sm text-[#111320]/70">
          Enter the 6-digit code sent to <span className="font-semibold">{email}</span>
        </div>

        <form onSubmit={handleVerifyCode} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-[#111320]/88">
              Verification Code
            </label>
            <Input
              type="text"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              autoComplete="one-time-code"
              placeholder="6-digit code"
              className="h-12 rounded-xl border-[#111320]/14 bg-white px-4 text-[16px]"
            />
          </div>

          {authError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {authError}
            </div>
          ) : null}

          <Button
            type="submit"
            disabled={!isLoaded || isLoading || code.length < 6}
            className="h-12 w-full rounded-xl bg-[linear-gradient(90deg,#3f45ff,#2f36e8)] text-base font-medium text-white hover:opacity-95"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying
              </>
            ) : (
              "Verify Account"
            )}
          </Button>
        </form>

        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => void handleResendCode()}
            className="font-medium text-[rgb(62,67,255)]"
          >
            Resend code
          </button>
          <button
            type="button"
            onClick={() => setStep("credentials")}
            className="text-[#111320]/58"
          >
            Edit email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSignUp} className="space-y-4">
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
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Create password"
            className="h-12 rounded-xl border-[#111320]/14 bg-white px-4 text-[16px]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-[#111320]/88">
            Confirm Password
          </label>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Re-enter password"
            className="h-12 rounded-xl border-[#111320]/14 bg-white px-4 text-[16px]"
          />
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
              Creating account
            </>
          ) : (
            "Create Account"
          )}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[#111320]/16" />
        <span className="text-sm text-[#111320]/52">Or Register With</span>
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
        Already Have An Account?{" "}
        <Link href="/sign-in" className="font-semibold text-[rgb(62,67,255)]">
          Log In.
        </Link>
      </p>
    </div>
  );
}
