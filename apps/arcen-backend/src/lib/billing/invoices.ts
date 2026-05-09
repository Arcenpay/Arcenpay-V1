import { db } from "../../db.js";

export function formatInvoiceNumber(
  prefix: string,
  year: number,
  sequence: number,
): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
}

export async function allocateInvoiceNumber(
  teamId: string,
  prefix: string,
  now = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();

  const seq = await db.invoiceSequence.upsert({
    where: { teamId_year: { teamId, year } },
    update: { lastNumber: { increment: 1 } },
    create: { teamId, year, lastNumber: 1 },
  });

  return formatInvoiceNumber(prefix, year, seq.lastNumber);
}

export function toSix(amount: number): string {
  return amount.toFixed(6);
}
