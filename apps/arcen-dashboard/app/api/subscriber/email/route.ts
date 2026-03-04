// ============================================================
//  Dashboard API — Subscriber Email Registration
//  Forwards email collection to the facilitator so the
//  EmailService can send welcome/billing notifications.
//  PRD §09 — Transactional Emails
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const FACILITATOR_URL =
    process.env.FACILITATOR_BASE_URL ||
    process.env.FACILITATOR_URL ||
    process.env.NEXT_PUBLIC_FACILITATOR_BASE_URL ||
    process.env.NEXT_PUBLIC_FACILITATOR_URL ||
    "http://localhost:3402";

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

        // Forward to facilitator — fire and forget acceptable since email is optional
        try {
            await fetch(`${FACILITATOR_URL}/api/subscriber/email`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(process.env.FACILITATOR_SECRET
                        ? { Authorization: `Bearer ${process.env.FACILITATOR_SECRET}` }
                        : {}),
                },
                body: JSON.stringify({ walletAddress, email, planId }),
            });
        } catch {
            // Non-fatal — still return ok to the client even if facilitator is down
            console.warn("[api/subscriber/email] Facilitator unreachable — email not stored");
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("[api/subscriber/email]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
