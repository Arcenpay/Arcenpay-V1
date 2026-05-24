import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import convex from "@/lib/convexClient";
import { getReceiptBillingClient } from "@/lib/arcenpay-server";
import { SCAN_FEATURE_KEY } from "@/lib/receipt-billing";
import { createAgent, createTool, openai } from "@inngest/agent-kit";
import { z } from "zod";

export const saveToDatabaseTool = createTool({
  name: "save-to-database",
  description: "save the given data into the convex database",
  parameters: z.object({
    fileDisplayName: z
      .string()
      .describe(
        "The readable name of the receipt to show in the UI. If the file name is not human readable use this to give a more readable name.",
      ),
    receiptId: z.string().describe("The ID of the receipt in the database"),
    merchantName: z.string(),
    merchantAddress: z.string(),
    merchantContact: z.string(),
    transactionDate: z.string(),
    transactionAmount: z
      .number()
      .describe(
        "The total amount of the transaction summing all the items in the receipt",
      ),
    currency: z.string(),
    receiptSummary: z
      .string()
      .optional()
      .describe(
        "A summary of the receipt, including the merchant name, address, contact, transaction date, transaction amount, and currency. Include a human readable summary of the receipt. Mention both invoice number and receipt number if both are present. Include some key details about the items on the receipt, this is a special featured summary so it should include some key details about the items on the receipt with some context.",
      ),
    aiSummaryEnabledAtScan: z.boolean().optional(),
    items: z.array(
      z.object({
        name: z.string(),
        quantity: z.number(),
        unitPrice: z.number(),
        totalPrice: z.number(),
      }),
    ),
    clerkUserId: z.string(),
    walletAddress: z.string().optional(),
  }) as any,
  handler: async (params, ctx) => {
    const {
      fileDisplayName,
      receiptId,
      merchantName,
      merchantAddress,
      merchantContact,
      transactionDate,
      transactionAmount,
      currency,
      receiptSummary,
      aiSummaryEnabledAtScan,
      items,
      clerkUserId,
      walletAddress,
    } = params;

    const result = await ctx.step?.run("save-receipt-to-database", async () => {
      // Save the receipt data to the database
      try {
        await convex.mutation(
          api.receipts.updateReceiptWithExtractedData,
          {
            id: receiptId as Id<"receipts">,
            currency,
            fileDisplayName,
            items,
            merchantAddress,
            merchantContact,
            merchantName,
            transactionDate,
            transactionAmount,
            receiptSummary,
            aiSummaryEnabledAtScan,
          },
        );

        const billingClient = await getReceiptBillingClient({
          clerkUserId,
          walletAddress,
        });
        await billingClient.consumeEntitlement({
          featureKey: SCAN_FEATURE_KEY,
          idempotencyKey: `receipt-scan:${receiptId}`,
        });

        return {
          addedToDb: "Success",
          receiptId,
          fileDisplayName,
          merchantName,
          merchantAddress,
          merchantContact,
          transactionDate,
          transactionAmount,
          currency,
          receiptSummary,
          aiSummaryEnabledAtScan,
          items,
        };
      } catch (error) {
        console.error("Error saving to database:", error);
        return { addedToDb: "Failed", error };
      }
    });

    if (result?.addedToDb === "Success") {
      ctx.network.state.kv.set("save-to-database", true);
      ctx.network.state.kv.set("receipt", receiptId);
    }
    return result;
  },
});

export const databaseAgent = createAgent({
  name: "Database Agent",
  description:
    "Agent responsible for saving extracted receipt data to the convex database.",
  system:
    "You are a helpful assistant that takes key information regarding receipts and saves it to the convex database.",
  model: openai({
    model: "gpt-4o-mini",
    defaultParameters: {
      max_completion_tokens: 1000,
    },
  }),
  tools: [saveToDatabaseTool],
});
