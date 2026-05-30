"use client";

import React, { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import convexClient from "@/lib/convexClient";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useReceiptBilling } from "@/hooks/use-receipt-billing";
import {
  FileText,
  Calendar,
  DollarSign,
  Store,
  MapPin,
  Phone,
  Package,
  ArrowLeft,
  Download,
  Trash2,
  Loader2,
  Clock,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ReceiptDetailClientProps {
  receiptId: string;
}

export default function ReceiptDetailClient({
  receiptId,
}: ReceiptDetailClientProps) {
  const router = useRouter();
  const { user } = useUser();
  const billing = useReceiptBilling();
  const refetchEntitlements = billing.refetchEntitlements;

  const receipt = useQuery(
    api.receipts.getReceiptById,
    receiptId
      ? {
          id: receiptId as Id<"receipts">,
          walletAddress: billing.walletAddress ?? undefined,
        }
      : "skip",
  );

  const deleteReceiptMutation = useMutation(api.receipts.deleteReceipt);

  const lastCompletedRef = useRef(false);

  useEffect(() => {
    const isCompleted = receipt?.status === "completed";
    if (isCompleted && !lastCompletedRef.current) {
      refetchEntitlements();
    }
    lastCompletedRef.current = isCompleted;
  }, [receipt?.status, refetchEntitlements]);

  const handleDownload = async () => {
    if (!receipt) return;

    try {
      const url = await convexClient.query(api.receipts.getReceiptDownloadUrl, {
        fileId: receipt.fileId,
      });

      if (url) {
        const link = document.createElement("a");
        link.href = url;
        link.download = receipt.fileName;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert("Failed to generate download URL. Please try again.");
      }
    } catch (error) {
      console.error("Error downloading receipt:", error);
      alert("Failed to download receipt. Please try again.");
    }
  };

  const handleDelete = async () => {
    if (!receipt) return;
    if (!confirm("Are you sure you want to delete this receipt?")) return;

    try {
      await deleteReceiptMutation({
        id: receipt._id,
        walletAddress: billing.walletAddress ?? undefined,
      });
      router.push("/recipts");
    } catch (error) {
      console.error("Error deleting receipt:", error);
      alert("Failed to delete receipt. Please try again.");
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-black dark:text-white mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-black dark:text-white mb-2">
            Sign In Required
          </h2>
          <p className="text-black dark:text-white">
            Please sign in to view receipt details
          </p>
        </div>
      </div>
    );
  }

  if (receipt === undefined) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-black dark:text-white" />
      </div>
    );
  }

  if (receipt === null) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-black dark:text-white mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-black dark:text-white mb-2">
            Receipt Not Found
          </h2>
          <p className="text-black dark:text-white mb-4">
            This receipt doesn&apos;t exist or you don&apos;t have access to it
          </p>
          <Button onClick={() => router.push("/recipts")}>
            Back to Receipts
          </Button>
        </div>
      </div>
    );
  }

  const aiSummaryLockedForReceipt =
    !receipt.receiptSummary && receipt.aiSummaryEnabledAtScan === false;
  const aiSummaryUnavailable =
    aiSummaryLockedForReceipt || !billing.canUseAiSummary;

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => router.push("/recipts")}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Receipts
          </Button>

          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold text-black dark:text-white mb-2">
                Receipt Details
              </h1>
              <p className="text-black dark:text-white">
                Uploaded on {new Date(receipt.uploadedAt).toLocaleDateString()}
              </p>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* File Info Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>File Information</CardTitle>
                  <Badge
                    variant={
                      receipt.status === "completed"
                        ? "default"
                        : receipt.status === "processing"
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {receipt.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-black dark:text-white" />
                    <div>
                      <p className="text-sm text-black dark:text-white">
                        Filename
                      </p>
                      <p className="font-semibold text-black dark:text-white">
                        {receipt.fileName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Package className="h-5 w-5 text-black dark:text-white" />
                    <div>
                      <p className="text-sm text-black dark:text-white">Size</p>
                      <p className="font-semibold text-black dark:text-white">
                        {(receipt.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-black dark:text-white" />
                    <div>
                      <p className="text-sm text-black dark:text-white">
                        Upload Date
                      </p>
                      <p className="font-semibold text-black dark:text-white">
                        {new Date(receipt.uploadedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Merchant Info Card */}
            {(receipt.merchantName ||
              receipt.merchantAddress ||
              receipt.merchantContact) && (
              <Card>
                <CardHeader>
                  <CardTitle>Merchant Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {receipt.merchantName && (
                      <div className="flex items-center gap-3">
                        <Store className="h-5 w-5 text-black dark:text-white" />
                        <div>
                          <p className="text-sm text-black dark:text-white">
                            Merchant Name
                          </p>
                          <p className="font-semibold text-black dark:text-white">
                            {receipt.merchantName}
                          </p>
                        </div>
                      </div>
                    )}

                    {receipt.merchantAddress && (
                      <div className="flex items-center gap-3">
                        <MapPin className="h-5 w-5 text-black dark:text-white" />
                        <div>
                          <p className="text-sm text-black dark:text-white">
                            Address
                          </p>
                          <p className="font-semibold text-black dark:text-white">
                            {receipt.merchantAddress}
                          </p>
                        </div>
                      </div>
                    )}

                    {receipt.merchantContact && (
                      <div className="flex items-center gap-3">
                        <Phone className="h-5 w-5 text-black dark:text-white" />
                        <div>
                          <p className="text-sm text-black dark:text-white">
                            Contact
                          </p>
                          <p className="font-semibold text-black dark:text-white">
                            {receipt.merchantContact}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Items List */}
            {receipt.items && receipt.items.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Items ({receipt.items.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {receipt.items.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 border border-black dark:border-white rounded-lg"
                      >
                        <div className="flex-1">
                          <p className="font-semibold text-black dark:text-white">
                            {item.name}
                          </p>
                          <p className="text-sm text-black dark:text-white">
                            Qty: {item.quantity} × ${item.unitPrice.toFixed(2)}
                          </p>
                        </div>
                        <p className="font-bold text-black dark:text-white">
                          ${item.totalPrice.toFixed(2)}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Summary Sidebar */}
          <div className="space-y-6">
            {/* Transaction Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Transaction Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {receipt.transactionDate && (
                    <div className="flex items-center gap-3">
                      <Calendar className="h-5 w-5 text-black dark:text-white" />
                      <div>
                        <p className="text-sm text-black dark:text-white">
                          Date
                        </p>
                        <p className="font-semibold text-black dark:text-white">
                          {receipt.transactionDate}
                        </p>
                      </div>
                    </div>
                  )}

                  {receipt.transactionAmount !== undefined && (
                    <div className="flex items-center gap-3">
                      <DollarSign className="h-5 w-5 text-black dark:text-white" />
                      <div>
                        <p className="text-sm text-black dark:text-white">
                          Total Amount
                        </p>
                        <p className="text-2xl font-bold text-black dark:text-white">
                          {receipt.currency || "$"}
                          {receipt.transactionAmount.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  )}

                  {receipt.items && receipt.items.length > 0 && (
                    <div className="flex items-center gap-3">
                      <Package className="h-5 w-5 text-black dark:text-white" />
                      <div>
                        <p className="text-sm text-black dark:text-white">
                          Items
                        </p>
                        <p className="font-semibold text-black dark:text-white">
                          {receipt.items.length} item(s)
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  AI Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                {receipt.receiptSummary ? (
                  <p className="text-sm leading-6 text-black dark:text-white">
                    {receipt.receiptSummary}
                  </p>
                ) : aiSummaryUnavailable ? (
                  <div className="space-y-3">
                    <p className="text-sm text-black dark:text-white">
                      {aiSummaryLockedForReceipt
                        ? "This receipt was scanned without `ai_summery` access, so only the scan details were processed."
                        : "AI summaries are only generated for workspaces with the `ai_summery` entitlement, typically on Pro plans."}
                    </p>
                    {!billing.canUseAiSummary && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push("/plans")}
                      >
                        Unlock in billing
                      </Button>
                    )}
                  </div>
                ) : receipt.status === "completed" ? (
                  <p className="text-sm text-black dark:text-white">
                    This receipt finished scanning, but no premium summary was
                    saved. Re-scan it if you want to try generating a new one.
                  </p>
                ) : (
                  <p className="text-sm text-black dark:text-white">
                    Premium AI summary will appear here after the receipt scan
                    finishes.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Processing Status */}
            {receipt.status === "processing" && (
              <Card>
                <CardHeader>
                  <CardTitle>Processing Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-black dark:text-white" />
                    <p className="text-sm text-black dark:text-white">
                      We are extracting your receipt details now. This usually
                      takes a few moments.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
