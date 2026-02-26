import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import crypto from "crypto";
import { sessionOptions, type SessionData } from "@/lib/session";

export async function GET() {
  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions,
  );
  const nonce = crypto.randomBytes(16).toString("hex");
  session.nonce = nonce;
  await session.save();
  return NextResponse.json({ nonce });
}
