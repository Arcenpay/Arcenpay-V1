import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { clerkUserId: session.clerkUserId },
    select: { walletAddress: true },
  });

  return NextResponse.json({ storedWallet: user?.walletAddress ?? null });
}
