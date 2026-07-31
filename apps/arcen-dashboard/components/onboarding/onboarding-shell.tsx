"use client";

import Image from "next/image";
import { Check } from "lucide-react";

export type OnboardingShellProps = {
  step: 1 | 2 | 3;
  stepTitle: string;
  stepDescription: string;
  children: React.ReactNode;
};

export function OnboardingShell({
  step,
  stepTitle,
  stepDescription,
  children,
}: OnboardingShellProps) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row font-sans bg-background">
      {/* Left Sidebar */}
      <aside className="w-full md:w-[260px] lg:w-[280px] shrink-0 border-b md:border-b-0 md:border-r border-border bg-card p-4 sm:p-6 md:p-8 md:py-10 flex flex-col">
        {/* Logo */}
        <div className="flex items-center">
          <Image
            src="/arcenpay-logo.png"
            alt="ArcenPay"
            width={160}
            height={40}
            className="h-9 w-auto object-contain dark:brightness-0 dark:invert"
            priority
            unoptimized
          />
        </div>

        {/* Step Info */}
        <div className="mt-5 md:mt-10">
          <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Onboarding
          </span>
          <h2 className="mt-1.5 text-base font-semibold text-foreground">
            {stepTitle}
          </h2>
          <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
            {stepDescription}
          </p>
        </div>

        {/* Step Tracker */}
        <div className="mt-5 md:mt-8 flex items-center gap-1 md:flex-col md:items-stretch md:gap-0">
          <StepItem
            number={1}
            title="Workspace Wallet"
            status={step > 1 ? "complete" : step === 1 ? "active" : "pending"}
          />
          <StepArrow />
          <StepItem
            number={2}
            title="Provider Profile"
            status={step > 2 ? "complete" : step === 2 ? "active" : "pending"}
          />
          <StepArrow />
          <StepItem
            number={3}
            title="Environment"
            status={step === 3 ? "active" : "pending"}
          />
        </div>
      </aside>

      {/* Right Content */}
      <main className="flex-1 overflow-auto bg-background">
        <div className="max-w-3xl mx-auto p-4 sm:p-6 md:p-10 lg:p-12">
          {children}
        </div>
      </main>
    </div>
  );
}

function StepItem({
  number,
  title,
  status,
}: {
  number: number;
  title: string;
  status: "pending" | "active" | "complete";
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-2 py-1.5 md:flex-none md:justify-start md:gap-3 md:py-2">
      {status === "complete" ? (
        <div className="w-5 h-5 rounded-full bg-brand flex items-center justify-center shrink-0">
          <Check className="w-3 h-3 text-primary-foreground" strokeWidth={2.5} />
        </div>
      ) : status === "active" ? (
        <div className="w-5 h-5 rounded-full border-2 border-brand flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-brand">{number}</span>
        </div>
      ) : (
        <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-medium text-muted-foreground/50">{number}</span>
        </div>
      )}
      <span
        className={`whitespace-nowrap text-[11px] md:text-[13px] ${
          status === "active"
            ? "font-semibold text-foreground"
            : status === "complete"
              ? "text-foreground font-medium"
              : "text-muted-foreground/60"
        }`}
      >
        {title}
      </span>
    </div>
  );
}

function StepArrow() {
  return <span className="shrink-0 px-0.5 text-muted-foreground/40 md:hidden" aria-hidden="true">→</span>;
}
