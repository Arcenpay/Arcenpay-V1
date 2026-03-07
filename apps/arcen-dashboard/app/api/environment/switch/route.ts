import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContractAddresses } from "@meap/core";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

const switchSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]),
  chainId: z.coerce.number().int().positive().optional(),
  confirmText: z.string().optional(),
});

function hasZeroAddress(addresses: object): boolean {
  return Object.values(addresses as Record<string, unknown>).some(
    (value) =>
      typeof value === "string" &&
      value.toLowerCase() === "0x0000000000000000000000000000000000000000",
  );
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission("environment:switch");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = switchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  if (parsed.data.confirmText !== "CONFIRM") {
    return NextResponse.json(
      { error: "confirmText must equal CONFIRM" },
      { status: 400 },
    );
  }

  const targetChainId =
    parsed.data.chainId ||
    (parsed.data.environmentMode === "PRODUCTION" ? 8453 : 11155111);

  let addresses: ReturnType<typeof getContractAddresses>;
  try {
    addresses = getContractAddresses(targetChainId);
  } catch {
    return NextResponse.json(
      { error: `No configured contracts for chain ${targetChainId}` },
      { status: 400 },
    );
  }

  if (
    parsed.data.environmentMode === "PRODUCTION" &&
    hasZeroAddress(addresses)
  ) {
    return NextResponse.json(
      {
        error:
          "Production switch blocked: contract registry contains zero-address placeholders.",
      },
      { status: 409 },
    );
  }

  const previous = await db.team.findUnique({
    where: { id: auth.team.teamId },
  });
  if (!previous) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const team = await db.team.update({
    where: { id: auth.team.teamId },
    data: { environmentMode: parsed.data.environmentMode },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    clerkUserId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "environment.switch",
    resourceType: "Team",
    resourceId: team.id,
    beforeData: {
      environmentMode: previous.environmentMode,
    },
    afterData: {
      environmentMode: team.environmentMode,
      chainId: targetChainId,
    },
  });

  return NextResponse.json({
    ok: true,
    teamId: team.id,
    environmentMode: team.environmentMode,
    chainId: targetChainId,
  });
}
