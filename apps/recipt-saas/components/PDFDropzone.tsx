"use client";

import React, { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadPdf } from "@/actions/uploadPdf";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReceiptBilling } from "@/hooks/use-receipt-billing";

interface PDFDropzoneProps {
  onUploadSuccess?: () => void;
}

export default function PDFDropzone({ onUploadSuccess }: PDFDropzoneProps) {
  const router = useRouter();
  const billing = useReceiptBilling();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    type: "success" | "error" | null;
    message: string;
  }>({ type: null, message: "" });
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(
    async (files: FileList) => {
      if (!files.length || !billing.walletAddress) {
        return;
      }

      const file = files[0];
      const maxSize = 10 * 1024 * 1024;

      if (file.type !== "application/pdf") {
        setUploadStatus({
          type: "error",
          message: "Please upload a PDF file only.",
        });
        return;
      }

      if (file.size > maxSize) {
        setUploadStatus({
          type: "error",
          message: "File size must be less than 10MB.",
        });
        return;
      }

      setIsUploading(true);
      setUploadStatus({ type: null, message: "" });

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("walletAddress", billing.walletAddress);

        const result = await uploadPdf(formData);

        if (!result.sucess) {
          setUploadStatus({
            type: "error",
            message: result.message || "Upload failed. Please try again.",
          });
          return;
        }

        setUploadStatus({
          type: "success",
          message: `${file.name} uploaded successfully. Opening the receipt...`,
        });

        onUploadSuccess?.();

        if (result.data?.receiptId) {
          setTimeout(() => {
            router.push(`/recipts/${result.data?.receiptId}`);
          }, 700);
        }
      } catch (cause) {
        setUploadStatus({
          type: "error",
          message:
            cause instanceof Error
              ? cause.message
              : "An unexpected error occurred during upload.",
        });
      } finally {
        setIsUploading(false);
      }
    },
    [billing.walletAddress, onUploadSuccess, router],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDraggingOver(false);

      if (!billing.canScan) {
        return;
      }

      if (event.dataTransfer.files.length > 0) {
        void handleUpload(event.dataTransfer.files);
      }
    },
    [billing.canScan, handleUpload],
  );

  const handleClick = useCallback(() => {
    if (!billing.canScan) {
      return;
    }

    fileInputRef.current?.click();
  }, [billing.canScan]);

  const helperMessage = !billing.isSignedIn
    ? "Sign in to start uploading receipts."
    : billing.walletMismatch
      ? `Reconnect the Clerk-linked wallet ${billing.clerkWalletAddress?.slice(0, 6)}...${billing.clerkWalletAddress?.slice(-4)} to upload in this workspace.`
    : billing.walletRequired
      ? "Connect the billing wallet before uploading."
      : billing.scanEntitlement?.exceeded
        ? "Your current plan has reached its scan limit."
        : !billing.scanEntitlement?.enabled
          ? "This workspace does not currently have scan access."
          : "Supports PDF files up to 10MB.";

  return (
    <div className="w-full space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        disabled={isUploading || !billing.canScan}
        onChange={(event) => {
          if (event.target.files?.length) {
            void handleUpload(event.target.files);
          }
        }}
      />

      <div
        className={[
          "relative rounded-3xl border-2 border-dashed p-10 text-center transition-all",
          billing.canScan
            ? "cursor-pointer border-primary/35 bg-primary/[0.03] hover:border-primary/60"
            : "cursor-not-allowed border-border/70 bg-muted/30",
          isDraggingOver ? "scale-[1.01] border-primary" : "",
          isUploading ? "pointer-events-none" : "",
        ].join(" ")}
        onClick={handleClick}
        onDragLeave={
          billing.canScan
            ? (event) => {
                event.preventDefault();
                setIsDraggingOver(false);
              }
            : undefined
        }
        onDragOver={
          billing.canScan
            ? (event) => {
                event.preventDefault();
                setIsDraggingOver(true);
              }
            : undefined
        }
        onDrop={billing.canScan ? handleDrop : undefined}
      >
        <div className="flex flex-col items-center gap-4">
          {isUploading ? (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div className="space-y-2">
                <p className="text-lg font-semibold">Uploading receipt...</p>
                <p className="text-sm text-muted-foreground">
                  We are storing the PDF and dispatching receipt extraction.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="relative rounded-2xl bg-primary/10 p-4 text-primary">
                {billing.walletRequired ? (
                  <Wallet className="h-10 w-10" />
                ) : (
                  <Upload className="h-10 w-10" />
                )}
                <FileText className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-background p-0.5 text-foreground" />
              </div>
              <div className="space-y-2">
                <p className="text-lg font-semibold">
                  {billing.canScan
                    ? "Drop a receipt PDF here or click to browse"
                    : billing.walletMismatch
                      ? "Wrong wallet connected"
                    : billing.walletRequired
                      ? "Connect MetaMask to unlock uploading"
                      : billing.scanEntitlement?.exceeded
                        ? "Scan limit reached"
                        : "Upload unavailable"}
                </p>
                <p className="text-sm text-muted-foreground">{helperMessage}</p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                {billing.walletRequired ? (
                  <Button
                    className="rounded-full"
                    disabled={billing.walletConnecting}
                    onClick={(event) => {
                      event.stopPropagation();
                      void billing.connectWallet();
                    }}
                  >
                    {billing.walletConnecting ? "Connecting..." : "Connect MetaMask"}
                  </Button>
                ) : (
                  <>
                    <span className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">
                      {billing.usageLabel}
                    </span>
                    {billing.walletAddress && (
                      <span className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">
                        {billing.walletAddress.slice(0, 6)}...
                        {billing.walletAddress.slice(-4)}
                      </span>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {uploadStatus.type && (
        <div
          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${
            uploadStatus.type === "success"
              ? "border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100"
              : "border-rose-500/30 bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-100"
          }`}
        >
          {uploadStatus.type === "success" ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          <p>{uploadStatus.message}</p>
        </div>
      )}
    </div>
  );
}
