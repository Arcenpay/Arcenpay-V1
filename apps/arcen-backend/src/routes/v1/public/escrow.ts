import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { escrowService } from "../../../services/escrow.service.js";
import type { EscrowMode, SettlementConfirmation, DisputeClaim } from "@arcenpay/internal-core";

const ESCROW_MODES = ["exact_hash", "schema_conformance", "attestation"] as const;
const DISPUTE_REASONS = [
  "hash_mismatch",
  "schema_violation",
  "sample_contradiction",
  "non_delivery",
] as const;

// This router is public and unauthenticated, so every field is bounded — an
// unbounded string would otherwise be persisted verbatim into the in-memory
// escrow store.
const reserveSchema = z.object({
  requestNonce: z.string().min(1).max(128),
  payerWallet: z.string().min(1).max(128),
  recipientWallet: z.string().min(1).max(128),
  amount: z.union([z.string().min(1).max(64), z.number()]),
  amountAtomic: z.union([z.string().max(64), z.number()]).optional(),
  tokenAddress: z.string().max(128).optional(),
  chainId: z.coerce.number().int().positive().optional(),
  mode: z.enum(ESCROW_MODES).optional(),
  challengeWindowSeconds: z.coerce.number().int().nonnegative().max(2_592_000).optional(),
  commitment: z.unknown().optional(),
  sessionId: z.string().max(128).optional(),
});

const confirmSchema = z
  .object({ requestNonce: z.string().min(1).max(128) })
  .passthrough();

const disputeSchema = z
  .object({
    requestNonce: z.string().min(1).max(128),
    failureReason: z.enum(DISPUTE_REASONS),
  })
  .passthrough();

function badRequest(c: Context, error: z.ZodError) {
  return c.json(
    {
      error: "Invalid request",
      code: "BAD_REQUEST",
      details: error.flatten().fieldErrors,
    },
    400 as any,
  );
}

export const publicEscrowRoutes = new Hono()
  .post("/reserve", async (c: Context) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400 as any);
    }

    const parsed = reserveSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error);
    const data = parsed.data;

    const reservation = escrowService.createReservation({
      requestNonce: data.requestNonce,
      sessionId: data.sessionId ? String(data.sessionId) : undefined,
      payerWallet: data.payerWallet,
      recipientWallet: data.recipientWallet,
      amount: String(data.amount),
      amountAtomic: String(data.amountAtomic ?? "0"),
      tokenAddress: String(data.tokenAddress ?? ""),
      chainId: data.chainId ?? 84532,
      mode: (data.mode as EscrowMode) || "exact_hash",
      challengeWindowSeconds: data.challengeWindowSeconds,
      commitment: (data.commitment ?? null) as never,
    });

    return c.json({ ok: true, reservation });
  })
  .post("/confirm", async (c: Context) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400 as any);
    }

    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error);

    const result = escrowService.confirmReservation(
      parsed.data as unknown as SettlementConfirmation,
    );
    return c.json(result);
  })
  .post("/dispute", async (c: Context) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400 as any);
    }

    const parsed = disputeSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error);

    const receipt = escrowService.disputeReservation(
      parsed.data as unknown as DisputeClaim,
    );
    return c.json({ ok: true, receipt });
  })
  .get("/status", async (c: Context) => {
    const requestNonce = c.req.query("requestNonce");
    if (!requestNonce) {
      return c.json({ error: "Missing requestNonce query parameter" }, 400 as any);
    }

    const status = escrowService.getStatus(requestNonce);
    return c.json(status);
  });
