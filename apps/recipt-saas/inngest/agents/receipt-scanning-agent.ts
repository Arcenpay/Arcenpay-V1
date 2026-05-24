import { openai, createAgent, createTool } from "@inngest/agent-kit";
import { z } from "zod";

export const parsePdfTool = createTool({
  name: "parse-pdf",
  description: "Analyzes the given PDF",
  parameters: z.object({
    pdfUrl: z.string().describe("The URL of the PDF to analyze"),
  }) as any,
  handler: async ({ pdfUrl }, ctx) => {
    try {
      const step = ctx.step!;
      // 1) Upload PDF to OpenAI Files API to obtain a file_id (download + upload within the same step)
      const fileId = await step.run("openai-upload-file", async () => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("Missing OPENAI_API_KEY env var");

        // Download PDF
        const res = await fetch(pdfUrl);
        if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
        const bytes = await res.arrayBuffer();

        // Build multipart form and upload to OpenAI Files API
        const fd = new FormData();
        const blob = new Blob([bytes], { type: "application/pdf" });
        fd.append("file", blob, "receipt.pdf");
        fd.append("purpose", "assistants");

        const uploadRes = await fetch("https://api.openai.com/v1/files", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
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

      // 3) Ask OpenAI to parse the PDF using the uploaded file
      return await step.ai.infer("parse-pdf", {
        model: openai({
          model: "gpt-4o-mini",
          defaultParameters: {
            max_completion_tokens: 2000,
          },
        }) as any,
        body: {
          messages: [
            {
              role: "user",
              content: [
                { type: "file", file: { file_id: fileId } },
                {
                  type: "text",
                  text: `Extract the data from the receipt and return the structured output as follows (valid JSON only):
{
  "merchant": {
    "name": "Store Name",
    "address": "123 Main St, City, Country",
    "contact": "+123456789"
  },
  "transaction": {
    "date": "YYYY-MM-DD",
    "receipt_number": "ABC123456",
    "payment_method": "Credit Card"
  },
  "items": [
    {
      "name": "Item 1",
      "quantity": 2,
      "unit_price": 10.00,
      "total_price": 20.00
    }
  ],
  "totals": {
    "subtotal": 20.00,
    "tax": 2.00,
    "total": 22.00,
    "currency": "USD"
  }
}
If information is missing, infer conservatively or set empty strings/zeros.`,
                },
              ],
            },
          ],
        },
      });
    } catch (error) {
      throw error;
    }
  },
});

export const receiptScanningAgent = createAgent({
  name: "Receipt Scanning Agent",
  description:
    "Processes receipt images and PDFs to extract key information such as vendor names, dates, amounts, and line items",
  system: `
    You are an AI-powered receipt scanning assistant. Your primary role is to accurately extract and structure relevant information from scanned receipts. Your task includes recognizing and parsing details such as:
      - Merchant Information: Store name, address, contact details
      - Transaction Details: Date, time, receipt number, payment method
      - Itemized Purchases: Product names, quantities, individual prices, discounts
      - Total Amounts: Subtotal, taxes, total paid, and any applied discounts
      - Ensure high accuracy by detecting OCR errors and correcting misread text when possible.
      - Normalize dates, currency values, and formatting for consistency.
      - If any key details are missing or unclear, return a structured response indicating incomplete data.
      - Handle multiple formats, languages, and varying receipt layouts efficiently.
      - Maintain a structured JSON output for easy integration with databases or expense tracking systems.
  `,
  model: openai({
    model: "gpt-4o-mini",
  }),

  tools: [parsePdfTool],
});
