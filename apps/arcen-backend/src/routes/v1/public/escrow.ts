import { Hono } from "hono";
import type { Context } from "hono";
import { escrowService } from "../../../services/escrow.service.js";
import type { EscrowMode, SettlementConfirmation, DisputeClaim } from "@arcenpay/internal-core";

export const publicEscrowRoutes = new Hono()
  .post("/reserve", async (c: Context) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.requestNonce || !body.payerWallet || !body.recipientWallet || !body.amount) {
      return c.json({ error: "Missing required fields for escrow reservation" }, 400);
    }

    const reservation = escrowService.createReservation({
      requestNonce: String(body.requestNonce),
      sessionId: body.sessionId ? String(body.sessionId) : undefined,
      payerWallet: String(body.payerWallet),
      recipientWallet: String(body.recipientWallet),
      amount: String(body.amount),
      amountAtomic: String(body.amountAtomic ?? "0"),
      tokenAddress: String(body.tokenAddress ?? ""),
      chainId: Number(body.chainId ?? 84532),
      mode: (body.mode as EscrowMode) || "exact_hash",
      challengeWindowSeconds: body.challengeWindowSeconds ? Number(body.challengeWindowSeconds) : undefined,
      commitment: body.commitment ?? null,
    });

    return c.json({ ok: true, reservation });
  })
  .post("/confirm", async (c: Context) => {
    let body: SettlementConfirmation;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.requestNonce) {
      return c.json({ error: "Missing requestNonce" }, 400);
    }

    const result = escrowService.confirmReservation(body);
    return c.json(result);
  })
  .post("/dispute", async (c: Context) => {
    let body: DisputeClaim;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.requestNonce || !body.failureReason) {
      return c.json({ error: "Missing requestNonce or failureReason" }, 400);
    }

    const receipt = escrowService.disputeReservation(body);
    return c.json({ ok: true, receipt });
  })
  .get("/status", async (c: Context) => {
    const requestNonce = c.req.query("requestNonce");
    if (!requestNonce) {
      return c.json({ error: "Missing requestNonce query parameter" }, 400);
    }

    const status = escrowService.getStatus(requestNonce);
    return c.json(status);
  });
