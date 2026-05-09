import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "../../../config.js";

const EmailSchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid wallet address"),
  email: z.string().email("Invalid email address"),
  planId: z.string().optional(),
});

export async function registerEmail(c: Context) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = EmailSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
          error: "Invalid request",
          details: parsed.error.flatten().fieldErrors,
        }, 400 as any);
    }

    const { walletAddress, email, planId } = parsed.data;

    await db.subscriberEmail.upsert({
      where: { walletAddress },
      update: { email, planId: planId ?? null },
      create: { walletAddress, email, planId: planId ?? null },
    });

    fetch(`${FACILITATOR_URL}/api/subscriber/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(FACILITATOR_SECRET
          ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
          : {}),
      },
      body: JSON.stringify({ walletAddress, email, planId }),
    }).catch(() => {
      // Non-fatal — DB record is the source of truth
    });

    return c.json({ ok: true });
  } catch (err) {
    console.error("[subscriber/email]", err);
    return c.json({ error: "Internal server error" }, 500 as any);
  }
}
