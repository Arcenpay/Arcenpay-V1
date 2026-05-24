"use server";
import convex from "@/lib/convexClient";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export async function getFileDownloadUrl(fileId: Id<"_storage">) {
  try {
    const downloadUrl = await convex.query(api.receipts.getReceiptDownloadUrl, {
      fileId,
    });

    if (!downloadUrl) {
      throw new Error("Failed to retrieve download URL");
    }

    return { success: true, url: downloadUrl };
  } catch (error) {
    return {
      success: false,
      error: {
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
      },
    };
  }
}
