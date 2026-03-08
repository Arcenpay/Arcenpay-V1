// ============================================================
//  Dashboard API — Subscriber Email Registration
//  POST /api/subscriber/email
//
//  Stores the subscriber's email in the local DB so the
//  EmailService can send billing notifications and invoices.
//  Also forwards to the facilitator for its own email registry.
//  PRD §09 — Transactional Emails
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "@/lib/config";

const EmailSchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid wallet address"),
  email: z.string().email("Invalid email address"),
  planId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = EmailSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { walletAddress, email, planId } = parsed.data;

    // Persist to DB — canonical source of truth for subscriber emails
    await db.subscriberEmail.upsert({
      where: { walletAddress },
      update: { email, planId: planId ?? null },
      create: { walletAddress, email, planId: planId ?? null },
    });

    // Also forward to facilitator for its in-memory registry (best-effort)
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/subscriber/email]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
