import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { SiweMessage } from "siwe";
import { sessionOptions, type SessionData } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(
      await cookies(),
      sessionOptions,
    );
    const { message, signature } = await req.json();

    const siweMessage = new SiweMessage(message);
    const { data: fields } = await siweMessage.verify({
      signature,
      nonce: session.nonce,
    });

    session.address = fields.address;
    session.chainId = fields.chainId;
    session.isProvider = true;
    session.isLoggedIn = true;
    session.nonce = "";
    await session.save();

    return NextResponse.json({ ok: true, address: fields.address });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Verification failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
