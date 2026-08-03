"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { setOnboardingChainFamily } from "@/lib/onboarding-chain-family";
import { NetworkIcon } from "@web3icons/react/dynamic";
import type { ChainFamily } from "@arcenpay/internal-core";

export default function ChainFamilyPage() {
  const router = useRouter();

  const select = (family: ChainFamily) => {
    setOnboardingChainFamily(family);
    router.push("/onboarding/wallet");
  };

  return (
    <OnboardingShell
      step={1}
      stepTitle="Choose Blockchain"
      stepDescription="Select your blockchain ecosystem to continue."
    >
      <div className="max-w-lg">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-[28px] font-semibold text-foreground tracking-tight">
            Choose your blockchain
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-3 leading-relaxed">
            Select the blockchain ecosystem for your billing workspace. You can
            add more later.
          </p>
        </div>

        <div className="grid gap-4">
          {/* EVM Card */}
          <Card
            className="p-5 cursor-pointer hover:border-brand/40 hover:bg-accent/5 transition-colors border-2 group"
            onClick={() => select("evm")}
          >
            <div className="flex items-start gap-4">
              <div
                className="relative flex shrink-0"
                style={{ width: 56, height: 44 }}
              >
                <NetworkIcon
                  name="ethereum"
                  variant="branded"
                  size={28}
                  className="rounded-full bg-white dark:bg-white p-[2px] absolute left-[28px] top-0 z-0 ring-2 ring-background"
                />
                <NetworkIcon
                  name="Arc"
                  variant="branded"
                  size={28}
                  className="rounded-full bg-white dark:bg-white p-[2px] absolute left-[14px] top-0 z-10 ring-2 ring-background"
                />
                <NetworkIcon
                  name="base"
                  variant="branded"
                  size={28}
                  className="rounded-full bg-white dark:bg-white p-[2px] absolute left-0 top-0 z-20 ring-2 ring-background"
                />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-foreground group-hover:text-brand transition-colors">
                  EVM Networks
                </h3>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  Base, Arc, Ethereum — connect with MetaMask, Rainbow, or any
                  WalletConnect-compatible wallet.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {["Ethereum", "Sepolia", "Base", "Arc Testnet"].map((c) => (
                    <span
                      key={c}
                      className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* Stellar Card */}
          <Card
            className="p-5 cursor-pointer hover:border-brand/40 hover:bg-accent/5 transition-colors border-2 group"
            onClick={() => select("stellar")}
          >
            <div className="flex items-start gap-4">
              <div className="w-[44px] h-[44px] rounded-full bg-white dark:bg-white flex items-center justify-center shrink-0 ring-2 ring-background">
                <NetworkIcon name="stellar" variant="branded" size={30} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-foreground group-hover:text-brand transition-colors">
                  Stellar Networks
                </h3>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  Stellar Mainnet &amp; Testnet with Soroban smart contracts —
                  connect with Freighter wallet.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {["Stellar Testnet", "Stellar Mainnet"].map((c) => (
                    <span
                      key={c}
                      className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </OnboardingShell>
  );
}
