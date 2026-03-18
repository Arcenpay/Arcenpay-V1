import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  BadgeDollarSign,
  ChartNoAxesColumn,
  Gauge,
} from "lucide-react";

type AuthShellProps = {
  mode: "sign-in" | "sign-up";
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthShell({ mode, title, description, children }: AuthShellProps) {
  const authCtaHref = mode === "sign-in" ? "/sign-up" : "/sign-in";
  const authCtaText = mode === "sign-in" ? "Create account" : "Back to sign in";
  const rightTitle =
    mode === "sign-in"
      ? "Effortlessly manage your team and operations."
      : "Launch your workspace and ship faster.";
  const rightDescription =
    mode === "sign-in"
      ? "Log in to access your dashboard and continue subscription operations."
      : "Create your account to configure billing, plans, and payouts in minutes.";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#eaecf2] text-[#111320]">
      <div className="pointer-events-none absolute inset-0 opacity-55">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 15%, rgba(255,255,255,0.42), rgba(255,255,255,0) 36%)",
          }}
        />
      </div>

      <div className="relative grid min-h-screen lg:grid-cols-2">
        <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px bg-[#111320]/8 lg:block" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(255,255,255,0.6),transparent_35%)]" />

        <section className="relative flex min-h-screen flex-col bg-[#f9fafd] px-6 py-8 md:px-12 md:py-10">
          <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col">
            <div className="flex items-center justify-between">
              <Link
                href="/"
                className="inline-flex items-center"
              >
                <Image
                  src="/arcenpay-logo.png"
                  alt="ArcenPay"
                  width={178}
                  height={44}
                  className="h-10 w-auto object-contain"
                  priority
                />
              </Link>
              <Link
                href={authCtaHref}
                className="text-sm font-medium text-[rgb(57,61,255)] hover:underline"
              >
                {authCtaText}
              </Link>
            </div>

            <div className="mx-auto mt-10 flex w-full max-w-[420px] flex-1 flex-col justify-center">
              <h1 className="font-display text-center text-[44px] leading-[1.04] tracking-tight text-[#111320] md:text-[56px]">
                {title}
              </h1>
              <p className="mt-3 text-center text-lg text-[#111320]/52">
                {description}
              </p>

              <div className="mt-9">{children}</div>
            </div>

            <div className="mt-8 flex items-center justify-between text-sm text-[#111320]/44">
              <span>Copyright © 2026 ArcenPay</span>
              <span className="hidden sm:inline">Privacy Policy</span>
            </div>
          </div>
        </section>

        <section className="relative hidden min-h-screen overflow-hidden bg-[linear-gradient(180deg,#3d44ff,#2f36e8)] p-12 text-white lg:flex lg:flex-col">
            <div className="pointer-events-none absolute inset-0 opacity-35">
              <div className="absolute -top-20 left-1/4 h-72 w-72 rounded-full bg-white/16" />
              <div className="absolute bottom-[-90px] right-[-40px] h-72 w-72 rounded-full bg-white/14" />
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.07) 1px,transparent 1px)",
                  backgroundSize: "120px 120px",
                }}
              />
            </div>

            <div className="relative z-10 mx-auto mt-4 w-full max-w-[580px]">
              <p className="font-mono text-sm uppercase tracking-[0.2em] text-white/70">
                Arcen Control
              </p>
              <h2 className="mt-6 text-5xl font-semibold leading-[1.1]">
                {rightTitle}
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-white/78">
                {rightDescription}
              </p>
            </div>

            <div className="relative z-10 mx-auto mt-auto w-full max-w-[580px] rounded-xl border border-white/35 bg-white/94 p-4 text-[#161824] shadow-[0_14px_40px_rgba(7,9,35,0.25)]">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-[#3f45ff] p-3 text-white">
                  <div className="text-xs text-white/80">Total Sales</div>
                  <div className="mt-2 flex items-center gap-2">
                    <BadgeDollarSign className="h-4 w-4" />
                    <span className="text-xl font-semibold">$189k</span>
                  </div>
                </div>
                <div className="rounded-lg border border-[#161824]/12 bg-white p-3">
                  <div className="text-xs text-[#161824]/54">Runtime</div>
                  <div className="mt-2 flex items-center gap-2 text-xl font-semibold">
                    <Gauge className="h-4 w-4 text-[#3f45ff]" />
                    00:01:30
                  </div>
                </div>
                <div className="rounded-lg border border-[#161824]/12 bg-white p-3">
                  <div className="text-xs text-[#161824]/54">Performance</div>
                  <div className="mt-2 flex items-center gap-2 text-xl font-semibold">
                    <ChartNoAxesColumn className="h-4 w-4 text-[#3f45ff]" />
                    6,248
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div className="h-2 rounded-full bg-[#edf0ff]">
                  <div className="h-2 w-[74%] rounded-full bg-[#3f45ff]" />
                </div>
                <div className="h-2 rounded-full bg-[#edf0ff]">
                  <div className="h-2 w-[56%] rounded-full bg-[#5d63ff]" />
                </div>
                <div className="h-2 rounded-full bg-[#edf0ff]">
                  <div className="h-2 w-[38%] rounded-full bg-[#8890ff]" />
                </div>
              </div>
            </div>
          </section>
      </div>
    </div>
  );
}
