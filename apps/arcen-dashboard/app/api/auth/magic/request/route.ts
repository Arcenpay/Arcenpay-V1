// ============================================================
//  Dashboard API — Magic Link Request
//  POST /api/auth/magic/request
//
//  Body: { email: string }
//  Always returns { ok: true } to prevent email enumeration.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendMagicLinkEmail } from "@/lib/email";

const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

const Schema = z.object({
  email: z.string().email("Invalid email address").toLowerCase(),
});

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (v) => v.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = Schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { email } = parsed.data;

    // Upsert user — create if not seen before
    const user = await db.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    // Invalidate any existing unused tokens for this email
    await db.magicToken.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: new Date(0) }, // mark as consumed without revealing
    });

    // Create a new single-use token
    const token = randomHex(32); // 64 hex chars = 256 bits of entropy
    await db.magicToken.create({
      data: {
        token,
        email,
        expiresAt: new Date(Date.now() + MAGIC_TOKEN_TTL_MS),
        userId: user.id,
      },
    });

    // Send email — non-fatal so we always return ok to avoid enumeration
    try {
      await sendMagicLinkEmail(email, token);
    } catch (err) {
      console.error("[magic/request] Email send failed:", err);
    }

    // Always 200 — never reveal whether the email exists
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/magic/request]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
