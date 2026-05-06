import { NextRequest, NextResponse } from "next/server";
import { generateNonce } from "@/lib/nonce.server";
import { authNonceProtect } from "@/lib/arcjet";
import { getSession } from "@/lib/auth.server";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const decision = await authNonceProtect.protect(request);
  if (decision.isDenied()) {
    if (decision.reason.isBot()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  const nonce = await generateNonce();
  return NextResponse.json(nonce);
}
