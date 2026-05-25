"use client";

import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  CreditCard,
  FileText,
  Loader2,
  ReceiptText,
  Sparkles,
  Wallet,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import PDFDropzone from "@/components/PDFDropzone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useReceiptBilling } from "@/hooks/use-receipt-billing";
import { formatWalletAddress } from "@/lib/receipt-billing";

export default function DashboardClient() {
  const { user, isLoaded } = useUser();
  const billing = useReceiptBilling();
  const refetchEntitlements = billing.refetchEntitlements;
  const receipts = useQuery(
    api.receipts.getReceipts,
    user?.id
      ? { userId: user.id, walletAddress: billing.walletAddress ?? undefined }
      : "skip",
  );

  const totalReceipts = receipts?.length ?? 0;
  const processedReceipts =
    receipts?.filter((receipt) => receipt.status === "completed").length ?? 0;
  const processingReceipts =
    receipts?.filter((receipt) => receipt.status === "processing").length ?? 0;

  const completedCountRef = useRef(processedReceipts);

  useEffect(() => {
    if (processedReceipts > completedCountRef.current) {
      refetchEntitlements();
    }
    completedCountRef.current = processedReceipts;
  }, [processedReceipts, refetchEntitlements]);
  const totalAmount =
    receipts?.reduce(
      (sum, receipt) => sum + (receipt.transactionAmount ?? 0),
      0,
    ) ?? 0;

  if (!isLoaded) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto flex min-h-[70vh] max-w-3xl items-center px-4 py-16">
        <Card className="w-full border-border/60 bg-card/90 shadow-sm">
          <CardHeader className="space-y-4 text-center">
            <Badge variant="secondary" className="mx-auto w-fit">
              Workspace access
            </Badge>
            <CardTitle className="text-3xl">Sign in to open the receipt workspace</CardTitle>
            <CardDescription className="text-base">
              Receipt uploads, scan quotas, and billing are managed per signed-in
              customer workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <SignInButton mode="modal">
              <Button size="lg" className="rounded-full px-8">
                Sign in with Clerk
              </Button>
            </SignInButton>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusTone =
    billing.scanEntitlement?.exceeded || !billing.scanEntitlement?.enabled
      ? "destructive"
      : "secondary";
  const aiSummaryTone =
    billing.aiSummaryEntitlement?.exceeded || !billing.aiSummaryEntitlement?.enabled
      ? "outline"
      : "secondary";
  const linkedWalletLabel = formatWalletAddress(billing.clerkWalletAddress);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(15,118,110,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(234,88,12,0.08),transparent_24%)]">
      <div className="container mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-border/60 bg-card/90 shadow-sm">
            <CardContent className="flex flex-col gap-6 p-6 md:p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-3">
                  <Badge variant="secondary" className="w-fit">
                    Receipt intelligence workspace
                  </Badge>
                  <div className="space-y-2">
                    <h1 className="text-4xl font-semibold tracking-tight">
                      Turn raw receipts into finance-ready records.
                    </h1>
                    <p className="max-w-2xl text-base text-muted-foreground">
                      Upload PDFs, extract merchant and total data with AI, and
                      enforce scan access through ArcenPay subscriptions.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button asChild variant="outline" className="rounded-full">
                    <Link href="/plans">Manage billing</Link>
                  </Button>
                  {billing.walletRequired ? (
                    <Button
                      className="rounded-full"
                      disabled={billing.walletConnecting}
                      onClick={() => void billing.connectWallet()}
                    >
                      <Wallet className="mr-2 h-4 w-4" />
                      {billing.walletConnecting ? "Connecting..." : "Connect MetaMask"}
                    </Button>
                  ) : billing.walletAddress ? (
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={billing.disconnectWallet}
                    >
                      Disconnect wallet
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Wallet className="h-4 w-4 text-primary" />
                    Billing wallet
                  </div>
                  <div className="text-lg font-semibold">
                    {formatWalletAddress(billing.walletAddress)}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Use the same wallet you linked in Clerk for this account.
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Clerk-linked wallet: {linkedWalletLabel}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <CreditCard className="h-4 w-4 text-primary" />
                    Active plan
                  </div>
                  <div className="text-lg font-semibold">
                    {billing.walletMismatch
                      ? "Wallet mismatch"
                      : billing.planTier
                        ? billing.planTier
                        : "No active plan"}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {billing.walletMismatch
                      ? "The connected wallet does not match the wallet linked in Clerk for this account."
                      : billing.isSubscribed
                      ? "ArcenPay is actively enforcing scan access for this wallet."
                      : "Choose a plan to unlock receipt scanning and metered usage."}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Sparkles className="h-4 w-4 text-primary" />
                    AI summary
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-semibold">
                      {billing.canUseAiSummary ? "Included" : "Pro feature"}
                    </span>
                    <Badge variant={aiSummaryTone}>
                      {billing.aiSummaryEntitlement?.enabled
                        ? billing.aiSummaryEntitlement?.exceeded
                          ? "Quota reached"
                          : "Ready"
                        : "Locked"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Premium receipt summaries are only generated when the
                    `ai_summary` entitlement is active.
                  </p>
                </div>

                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <ReceiptText className="h-4 w-4 text-primary" />
                    Scan quota
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-semibold">{billing.usageLabel}</span>
                    <Badge variant={statusTone}>
                      {billing.scanEntitlement?.enabled
                        ? billing.scanEntitlement?.exceeded
                          ? "Limit reached"
                          : "Ready"
                        : "Unavailable"}
                    </Badge>
                  </div>
                  {billing.allocation != null && (
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${billing.usagePercentage}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-slate-950 text-slate-50 shadow-sm">
            <CardHeader>
              <CardTitle className="text-2xl">Operational snapshot</CardTitle>
              <CardDescription className="text-slate-300">
                What this workspace has processed so far.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-sm text-slate-300">Receipts uploaded</p>
                <p className="mt-2 text-3xl font-semibold">{totalReceipts}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                  <p className="text-sm text-slate-300">Completed</p>
                  <p className="mt-2 text-2xl font-semibold">{processedReceipts}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                  <p className="text-sm text-slate-300">Processing</p>
                  <p className="mt-2 text-2xl font-semibold">{processingReceipts}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <p className="text-sm text-slate-300">Captured spend</p>
                <p className="mt-2 text-3xl font-semibold">
                  ${totalAmount.toFixed(2)}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        {(billing.walletRequired ||
          billing.walletMismatch ||
          billing.scanEntitlement?.exceeded ||
          !billing.scanEntitlement?.enabled) && (
          <Card className="mt-6 border-amber-400/40 bg-amber-50/70 shadow-sm dark:bg-amber-500/10">
            <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-300" />
                <div className="space-y-1">
                  <p className="font-medium text-amber-950 dark:text-amber-100">
                    {billing.walletMismatch
                      ? "Connected wallet does not match the Clerk-linked wallet for this account."
                      : billing.walletRequired
                      ? "Connect the billing wallet before uploading receipts."
                      : billing.scanEntitlement?.exceeded
                        ? "This workspace has reached its scan limit."
                        : "Receipt scanning is not available on the current plan."}
                  </p>
                  <p className="text-sm text-amber-900/80 dark:text-amber-100/80">
                    {billing.walletMismatch
                      ? `Disconnect the current wallet and reconnect ${linkedWalletLabel} to use this workspace.`
                      : "Move to the billing page to connect the correct wallet or upgrade the subscription before running more scans."}
                  </p>
                </div>
              </div>
              <Button asChild className="rounded-full">
                <Link href="/plans">
                  Open billing
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <section className="mt-8 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-border/60 bg-card/90 shadow-sm">
            <CardHeader>
              <CardTitle>Upload receipt</CardTitle>
              <CardDescription>
                PDF uploads are checked against the ArcenPay `scan`
                entitlement before processing starts, while premium summaries
                only run when `ai_summary` is available.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PDFDropzone />
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/90 shadow-sm">
            <CardHeader>
              <CardTitle>Recent receipts</CardTitle>
              <CardDescription>
                The latest documents extracted in this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!receipts ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : receipts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
                  <ReceiptText className="mx-auto h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-semibold">No receipts yet</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Upload your first PDF to create a searchable receipt record.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {receipts.slice(0, 5).map((receipt) => (
                    <div
                      key={receipt._id}
                      className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-background/70 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-primary/10 p-2 text-primary">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{receipt.fileName}</p>
                            <Badge
                              variant={
                                receipt.status === "completed"
                                  ? "secondary"
                                  : receipt.status === "processing"
                                    ? "outline"
                                    : "destructive"
                              }
                            >
                              {receipt.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {receipt.merchantName
                              ? `${receipt.merchantName} · `
                              : ""}
                            {receipt.transactionAmount != null
                              ? `$${receipt.transactionAmount.toFixed(2)}`
                              : "Awaiting extraction"}
                          </p>
                        </div>
                      </div>

                      <Button asChild variant="ghost" className="w-fit rounded-full">
                        <Link href={`/recipts/${receipt._id}`}>Open receipt</Link>
                      </Button>
                    </div>
                  ))}

                  <Button asChild variant="outline" className="mt-2 rounded-full">
                    <Link href="/recipts">View all receipts</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
