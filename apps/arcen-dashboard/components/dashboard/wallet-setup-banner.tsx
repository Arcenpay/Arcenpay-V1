"use client";

import { useState } from "react";
import { Shield, Wallet, X, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

interface WalletSetupBannerProps {
  /** The stored provider wallet address (null = never linked) */
  storedWallet: string | null;
}

export function WalletSetupBanner({ storedWallet }: WalletSetupBannerProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);

  // If wallet already linked, nothing to show
  if (storedWallet || dismissed) return null;

  return (
    <div className="mx-6 mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-400">
      <div className="px-5 py-4 flex items-start gap-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
          <Shield className="w-5 h-5 text-amber-500" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Set up your provider wallet
          </p>
          <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
            Link a wallet to your account to register plans on-chain and receive
            on-chain subscriptions. This is a one-time setup — you only need to
            do it once from any device.
          </p>

          {/* Steps */}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold text-[10px]">1</span>
              Connect your wallet
            </span>
            <ChevronRight className="w-3 h-3 self-center text-muted-foreground/50" />
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold text-[10px]">2</span>
              Sign a message (no gas)
            </span>
            <ChevronRight className="w-3 h-3 self-center text-muted-foreground/50" />
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center font-bold text-[10px]">3</span>
              Done — permanent link
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            onClick={() => router.push("/onboarding/wallet")}
            className="bg-amber-500 hover:bg-amber-600 text-white font-medium gap-1.5 h-8"
          >
            <Wallet className="w-3.5 h-3.5" />
            Connect Wallet
          </Button>
          <button
            onClick={() => setDismissed(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            title="Dismiss (wallet still needed for on-chain operations)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bottom note */}
      <div className="px-5 py-2 bg-amber-500/5 border-t border-amber-500/20 flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3 text-amber-500/70 shrink-0" />
        <p className="text-[11px] text-muted-foreground">
          You can browse the dashboard without a wallet, but on-chain plan registration requires it.
          Use the same wallet consistently — it becomes your permanent provider identity.
        </p>
      </div>
    </div>
  );
}
