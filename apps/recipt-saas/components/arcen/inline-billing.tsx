"use client";

import { ArcenEmbed } from "@arcenpay/react";
import { SignInButton } from "@clerk/nextjs";
import { CreditCard, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useReceiptBilling } from "@/hooks/use-receipt-billing";
import { formatWalletAddress } from "@/lib/receipt-billing";

export function InlineBilling({
  initialView = "checkout",
}: {
  initialView?: "portal" | "checkout" | "payment" | "success" | "unsubscribe";
}) {
  const billing = useReceiptBilling();

  if (!billing.isLoaded) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!billing.isSignedIn) {
    return (
      <Card className="border-border/70 bg-card/90 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Sign in to manage billing
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
          <p>
            Billing, wallet linking, and plan management are available once the
            workspace owner signs in.
          </p>
          <SignInButton mode="modal">
            <Button className="w-fit">Sign in with Clerk</Button>
          </SignInButton>
        </CardContent>
      </Card>
    );
  }

  if (billing.walletRequired) {
    return (
      <Card className="border-border/70 bg-card/90 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Connect the billing wallet
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
          <p>
            ArcenPay plans are attached to the customer wallet. Connect the same
            wallet that should own the receipt-scanning subscription.
          </p>
          <Button
            className="w-fit"
            disabled={billing.walletConnecting}
            onClick={() => void billing.connectWallet()}
          >
            {billing.walletConnecting ? "Connecting..." : "Connect MetaMask"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!billing.isIdentified || billing.isEntitlementLoading) {
    return (
      <div className="flex min-h-80 items-center justify-center rounded-3xl border border-border/70 bg-card/80">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Preparing your ArcenPay billing workspace...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/90 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {billing.planTier ? billing.planTier : "No active plan"}
              </Badge>
              <Badge variant={billing.scanEntitlement?.exceeded ? "destructive" : "outline"}>
                {billing.usageLabel}
              </Badge>
              <Badge variant={billing.canUseAiSummary ? "secondary" : "outline"}>
                {billing.canUseAiSummary ? "AI summary on" : "AI summary locked"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Wallet: {formatWalletAddress(billing.walletAddress)}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Receipt scans and premium AI summaries are enforced through ArcenPay entitlements.
          </div>
        </CardContent>
      </Card>

      <div className="rounded-3xl border border-border/70 bg-card/90 p-3 shadow-sm">
        <ArcenEmbed initialView={initialView} mode="inline" />
      </div>
    </div>
  );
}
