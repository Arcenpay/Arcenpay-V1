"use server";

import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { currentUser } from "@clerk/nextjs/server";
import { getFileDownloadUrl } from "./getFileDownloadUrl";
import { inngest } from "@/inngest/client";
import Event from "@/inngest/constant";
import { getReceiptBillingClient } from "@/lib/arcenpay-server";
import {
  normalizeWalletAddress,
  SCAN_FEATURE_KEY,
} from "@/lib/receipt-billing";

export async function uploadPdf(formData: FormData) {
  const user = await currentUser();

  if (!user) {
    return {
      success: false,
      message: "User not authenticated. Please sign in.",
    };
  }

  try {
    const file = formData.get("file") as File;
    const walletAddress = normalizeWalletAddress(
      String(formData.get("walletAddress") ?? "").trim() || null,
    );

    if (!file) {
      return { success: false, message: "No file provided" };
    }

    if (!walletAddress) {
      return {
        success: false,
        message: "Connect the billing wallet before uploading receipts.",
      };
    }

    //validate file type
    if (file.type !== "application/pdf") {
      return {
        success: false,
        message: "Invalid file type. Only PDFs are allowed.",
      };
    }

    if (file.size > 10 * 1024 * 1024) {
      return {
        success: false,
        message: "File size must be less than 10MB.",
      };
    }

    // Create a server-side Convex client
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const primaryEmail = user.primaryEmailAddress?.emailAddress ?? null;
    const displayName =
      user.fullName ??
      user.username ??
      user.firstName ??
      primaryEmail ??
      user.id;
    const billingClient = await getReceiptBillingClient({
      clerkUserId: user.id,
      email: primaryEmail,
      name: displayName,
      walletAddress,
    });
    const entitlement = await billingClient.checkEntitlement(SCAN_FEATURE_KEY);

    if (!entitlement.enabled || entitlement.exceeded) {
      return {
        success: false,
        message: entitlement.exceeded
          ? `Your current plan has used ${entitlement.usage} of ${entitlement.allocation ?? "unlimited"} scans. Upgrade in billing to continue.`
          : "Receipt scanning is not enabled for this workspace yet.",
      };
    }

    // handle convex upload logic here
    const uploadUrl = await convex.mutation(api.receipts.generateUploadUrl, {});

    console.log("Upload URL generated:", uploadUrl);

    const arrayBuffer = await file.arrayBuffer();
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
      },
      body: arrayBuffer,
    });

    console.log("Upload response status:", uploadResponse.status);

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("Upload failed:", errorText);
      return {
        success: false,
        message: `Failed to upload file to storage: ${uploadResponse.status}`,
      };
    }

    const { storageId } = await uploadResponse.json();
    console.log("Storage ID:", storageId);

    const receiptId = await convex.mutation(api.receipts.storeReceipt, {
      userId: user.id,
      fileId: storageId,
      fileName: file.name,
      size: file.size,
      mimeType: file.type,
      walletAddress,
    });

    await billingClient.track({
      name: "receipt_uploaded",
      idempotencyKey: `receipt-uploaded:${receiptId}`,
      traits: {
        receiptId,
        fileName: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
        source: "receipt_saas",
      },
    });

    const fileUrl = await getFileDownloadUrl(storageId);

    // TODO: Trigger inngest agent flow
    await inngest.send({
      name: Event.EXTRACT_DATA_FROM_PDF_AND_SAVE_TO_DATABASE,
      data: {
        url: fileUrl.url,
        receiptId,
        clerkUserId: user.id,
        walletAddress,
      },
    });

    return {
      success: true,
      data: {
        receiptId,
        fileName: file.name,
      },
      message: "File uploaded successfully",
    };
  } catch (error) {
    console.error("Error uploading file:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "File upload failed",
    };
  }
}
