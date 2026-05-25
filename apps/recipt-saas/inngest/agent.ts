import { openai } from "@inngest/agent-kit";
import { inngest } from "@/inngest/client";
import Event from "./constant";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import convex from "@/lib/convexClient";
import { getReceiptBillingClient } from "@/lib/arcenpay-server";
import {
  AI_SUMMARY_FEATURE_KEY,
  SCAN_FEATURE_KEY,
} from "@/lib/receipt-billing";

// Note: We previously used an Agent Network. That added routing loops causing
// long-running executions. To make the pipeline deterministic and fast, this
// function now performs two direct steps: parse with OpenAI, then save to Convex.

function extractAssistantText(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const choices = record.choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    return JSON.stringify(payload);
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return JSON.stringify(payload);
  }

  const message = (firstChoice as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    return JSON.stringify(payload);
  }

  const content = (message as Record<string, unknown>).content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }

        return "";
      })
      .join("")
      .trim();
  }

  return JSON.stringify(payload);
}

export const extractAndSavePDF = inngest.createFunction(
  { id: "extract-and-save-pdf" },
  { event: Event.EXTRACT_DATA_FROM_PDF_AND_SAVE_TO_DATABASE },
  async ({ event, step }) => {
    const { url, receiptId, fileDisplayName, clerkUserId, walletAddress } =
      event.data as {
      url: string;
      receiptId: string;
      fileDisplayName?: string;
      clerkUserId: string;
      walletAddress?: string | null;
    };
    const billingIdentity = {
      clerkUserId,
      walletAddress,
    };

    // 1) Upload the PDF to OpenAI Files API and get a file_id
    const fileId = await step.run("openai-upload-file", async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("Missing OPENAI_API_KEY env var");

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
      const bytes = await res.arrayBuffer();

      const fd = new FormData();
      const blob = new Blob([bytes], { type: "application/pdf" });
      fd.append("file", blob, "receipt.pdf");
      fd.append("purpose", "assistants");

      const uploadRes = await fetch("https://api.openai.com/v1/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
      });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(
          `OpenAI file upload failed: ${uploadRes.status} ${errText}`,
        );
      }
      const json = (await uploadRes.json()) as { id: string };
      return json.id;
    });

    // 2) Ask OpenAI to extract structured JSON from the uploaded PDF
    const raw = await step.ai.infer("infer-receipt-json", {
      model: openai({
        model: "gpt-4o-mini",
        defaultParameters: { max_completion_tokens: 2000 },
      }) as any,
      body: {
        messages: [
          {
            role: "user",
            content: [
              { type: "file", file: { file_id: fileId } },
              {
                type: "text",
                text: `Extract the receipt as strict JSON only. Respond with only a JSON object and nothing else.
Schema:
{
  "merchant": { "name": string, "address": string, "contact": string },
  "transaction": { "date": string, "receipt_number": string, "payment_method": string },
  "items": [{ "name": string, "quantity": number, "unit_price": number, "total_price": number }],
  "totals": { "subtotal": number, "tax": number, "total": number, "currency": string }
}
If a value is missing, use an empty string for text and 0 for numbers.`,
              },
            ],
          },
        ],
      },
    });

    // 3) Parse and normalize the model output into our DB fields
    const jsonText = extractAssistantText(raw);

    const extractFirstJson = (txt: string) => {
      // Remove code fences if present
      const cleaned = txt.replace(/^```[a-zA-Z]*\n?|```$/g, "").trim();
      // Try direct parse
      try {
        return JSON.parse(cleaned);
      } catch {}
      // Fallback: grab first {...} block
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        return JSON.parse(m[0]);
      }
      throw new Error("Model did not return JSON");
    };

    const parsed = await step.run("parse-json", async () =>
      extractFirstJson(jsonText),
    );

    const aiSummaryEntitlement = await step.run(
      "check-ai-summary-entitlement",
      async () => {
        try {
          const billingClient = await getReceiptBillingClient(billingIdentity);
          return await billingClient.checkEntitlement(AI_SUMMARY_FEATURE_KEY);
        } catch (error) {
          console.error("[receipt-saas] failed to check ArcenPay ai_summary access", {
            receiptId,
            clerkUserId,
            walletAddress,
            error,
          });
          return null;
        }
      },
    );
    const canGenerateAiSummary =
      Boolean(aiSummaryEntitlement?.enabled) && !aiSummaryEntitlement?.exceeded;

    // Map to DB shape with minimal coercion
    const merchant = parsed.merchant ?? {};
    const transaction = parsed.transaction ?? {};
    const totals = parsed.totals ?? {};
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    let receiptSummary: string | undefined;
    const hasSummaryInputs =
      Boolean(String(merchant.name ?? "").trim()) ||
      Boolean(String(transaction.date ?? "").trim()) ||
      Number(totals.total ?? 0) > 0 ||
      items.length > 0;

    if (canGenerateAiSummary && hasSummaryInputs) {
      try {
        const summaryResult = await step.ai.infer("generate-ai-summary", {
          model: openai({
            model: "gpt-4o-mini",
            defaultParameters: { max_completion_tokens: 250 },
          }) as any,
          body: {
            messages: [
              {
                role: "system",
                content:
                  "You create premium receipt summaries for finance teams. Write 2-4 concise sentences in plain text. Mention the merchant, date, total, payment method when available, and the most important purchased items. Do not use markdown or bullets.",
              },
              {
                role: "user",
                content: JSON.stringify({
                  merchant,
                  transaction,
                  totals,
                  items,
                }),
              },
            ],
          },
        });

        const summaryText = extractAssistantText(summaryResult).trim();
        if (
          summaryText &&
          !/no transaction details available/i.test(summaryText)
        ) {
          receiptSummary = summaryText;
        }
      } catch (error) {
        console.error("[receipt-saas] failed to generate premium AI summary", {
          receiptId,
          clerkUserId,
          walletAddress,
          error,
        });
      }
    }

    const dbPayload = {
      id: receiptId as Id<"receipts">,
      aiSummaryEnabledAtScan: canGenerateAiSummary,
      currency: String(totals.currency ?? "").toUpperCase(),
      fileDisplayName: fileDisplayName ?? merchant.name ?? "Receipt",
      items: items.map((it: any) => ({
        name: String(it.name ?? ""),
        quantity: Number(it.quantity ?? 0),
        unitPrice: Number(it.unit_price ?? it.unitPrice ?? 0),
        totalPrice: Number(it.total_price ?? it.totalPrice ?? 0),
      })),
      merchantAddress: String(merchant.address ?? ""),
      merchantContact: String(merchant.contact ?? ""),
      merchantName: String(merchant.name ?? ""),
      transactionDate: String(transaction.date ?? ""),
      transactionAmount: Number(totals.total ?? 0),
      receiptSummary,
    };

    // 4) Save into Convex
    const save = await step.run("save-receipt-to-database", async () => {
      await convex.mutation(
        api.receipts.updateReceiptWithExtractedData,
        dbPayload,
      );
      return { ok: true } as const;
    });

    const billing = await step.run("consume-scan-entitlement", async () => {
      try {
        const billingClient = await getReceiptBillingClient(billingIdentity);
        await billingClient.consumeEntitlement({
          featureKey: SCAN_FEATURE_KEY,
          idempotencyKey: `receipt-scan:${receiptId}`,
        });

        return { ok: true } as const;
      } catch (error) {
        console.error("[receipt-saas] failed to consume ArcenPay scan usage", {
          receiptId,
          clerkUserId,
          walletAddress,
          error,
        });
        return { ok: false } as const;
      }
    });

    const trackedScan = await step.run("track-receipt-scan-completed", async () => {
      try {
        const billingClient = await getReceiptBillingClient(billingIdentity);
        await billingClient.track({
          name: "receipt_scan_completed",
          idempotencyKey: `receipt-scan-completed:${receiptId}`,
          traits: {
            receiptId,
            merchantName: dbPayload.merchantName,
            transactionAmount: dbPayload.transactionAmount,
            currency: dbPayload.currency,
            itemCount: dbPayload.items.length,
            aiSummaryEntitled: canGenerateAiSummary,
            aiSummaryGenerated: Boolean(receiptSummary),
            source: "receipt_saas",
          },
        });

        return { ok: true } as const;
      } catch (error) {
        console.error("[receipt-saas] failed to track receipt scan completion", {
          receiptId,
          clerkUserId,
          walletAddress,
          error,
        });
        return { ok: false } as const;
      }
    });

    const summaryBilling = canGenerateAiSummary && Boolean(receiptSummary)
      ? await step.run("consume-ai-summary-entitlement", async () => {
          try {
            const billingClient = await getReceiptBillingClient(billingIdentity);
            await billingClient.consumeEntitlement({
              featureKey: AI_SUMMARY_FEATURE_KEY,
              idempotencyKey: `receipt-ai-summary:${receiptId}`,
            });

            return { ok: true } as const;
          } catch (error) {
            console.error("[receipt-saas] failed to consume ArcenPay ai_summary usage", {
              receiptId,
              clerkUserId,
              walletAddress,
              error,
            });
            return { ok: false } as const;
          }
        })
      : { ok: false } as const;

    const trackedSummary =
      canGenerateAiSummary && Boolean(receiptSummary)
        ? await step.run("track-ai-summary-generated", async () => {
            try {
              const billingClient = await getReceiptBillingClient(billingIdentity);
              await billingClient.track({
                name: "receipt_ai_summary_generated",
                idempotencyKey: `receipt-ai-summary-generated:${receiptId}`,
                traits: {
                  receiptId,
                  merchantName: dbPayload.merchantName,
                  summaryLength: receiptSummary?.length ?? 0,
                  source: "receipt_saas",
                },
              });

              return { ok: true } as const;
            } catch (error) {
              console.error("[receipt-saas] failed to track AI summary generation", {
                receiptId,
                clerkUserId,
                walletAddress,
                error,
              });
              return { ok: false } as const;
            }
          })
        : { ok: false } as const;

    return {
      billingApplied: billing.ok,
      summaryBillingApplied: summaryBilling.ok,
      scanTracked: trackedScan.ok,
      summaryTracked: trackedSummary.ok,
      receiptId,
      status: save.ok ? "saved" : "failed",
    } as const;
  },
);
