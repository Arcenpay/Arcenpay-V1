// ============================================================
//  Dashboard — Invoice Tax & Billing Address Validation
//
//  Supports US (state, zip, optional EIN) and India (GSTIN, HSN).
//  Country-specific rules are validated when billingAddress.country
//  is set — fields for other countries are ignored.
// ============================================================

import { z } from "zod";

// ── US ────────────────────────────────────────────────────────

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC","PR","GU","VI","AS","MP",
]);

const usAddressSchema = z.object({
  country: z.literal("US"),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  /** Two-letter US state/territory code */
  state: z
    .string()
    .length(2)
    .transform((v) => v.toUpperCase())
    .refine((v) => US_STATES.has(v), { message: "Invalid US state code" }),
  /** ZIP code — 5-digit or ZIP+4 */
  zip: z
    .string()
    .regex(/^\d{5}(-\d{4})?$/, { message: "ZIP must be 5 digits or 9-digit ZIP+4 (e.g., 12345 or 12345-6789)" }),
  /** Employer Identification Number — optional, format XX-XXXXXXX */
  ein: z
    .string()
    .regex(/^\d{2}-\d{7}$/, { message: "EIN must be in format XX-XXXXXXX" })
    .optional(),
  legalName: z.string().min(1).max(200).optional(),
});

// ── India ─────────────────────────────────────────────────────

/**
 * GSTIN format: 2 digit state code + 10 char PAN + 1 entity number + 1 check digit.
 * Pattern: \d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]
 */
const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Z][A-Z\d]$/;

const inAddressSchema = z.object({
  country: z.literal("IN"),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  pincode: z
    .string()
    .regex(/^\d{6}$/, { message: "PIN code must be exactly 6 digits" }),
  /** GSTIN — required for B2B invoices in India */
  gstin: z
    .string()
    .length(15)
    .transform((v) => v.toUpperCase())
    .refine((v) => GSTIN_REGEX.test(v), { message: "Invalid GSTIN format" })
    .optional(),
  /** HSN/SAC code — 4 to 8 digit service/goods classification code */
  hsnCode: z
    .string()
    .regex(/^\d{4,8}$/, { message: "HSN/SAC code must be 4–8 digits" })
    .optional(),
  legalName: z.string().min(1).max(200).optional(),
});

// ── Generic / other countries ─────────────────────────────────

const genericAddressSchema = z.object({
  country: z.string().length(2).transform((v) => v.toUpperCase()),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  legalName: z.string().min(1).max(200).optional(),
});

// ── Discriminated union ───────────────────────────────────────

export const billingAddressSchema = z.discriminatedUnion("country", [
  usAddressSchema,
  inAddressSchema,
]).or(genericAddressSchema);

export type BillingAddress = z.infer<typeof billingAddressSchema>;

// ── Tax ID helpers ────────────────────────────────────────────

/** Validates a GSTIN string and returns the embedded state code */
export function parseGSTIN(gstin: string): { stateCode: string; pan: string } | null {
  const upper = gstin.toUpperCase();
  if (!GSTIN_REGEX.test(upper)) return null;
  return {
    stateCode: upper.slice(0, 2),
    pan: upper.slice(2, 12),
  };
}

/** Validates an EIN string */
export function isValidEIN(ein: string): boolean {
  return /^\d{2}-\d{7}$/.test(ein);
}
