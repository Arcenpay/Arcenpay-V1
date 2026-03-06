import { NextResponse } from "next/server";
import { generateNonce } from "@/lib/nonce.server";

export async function GET() {
  const nonce = await generateNonce();
  return NextResponse.json(nonce);
}
