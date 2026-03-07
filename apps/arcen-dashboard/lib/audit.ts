import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { toPrismaNullableJson } from "@/lib/prisma-json";

export type AuditInput = {
  request: NextRequest;
  teamId: string;
  clerkUserId?: string;
  walletAddress?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: unknown;
};

export function buildRequestId(request: NextRequest): string {
  return (
    request.headers.get("x-request-id") ||
    request.headers.get("x-correlation-id") ||
    crypto.randomUUID()
  );
}

export async function writeAuditEvent(input: AuditInput): Promise<void> {
  const {
    request,
    teamId,
    clerkUserId,
    walletAddress,
    action,
    resourceType,
    resourceId,
  } = input;
  const requestId = buildRequestId(request);

  try {
    await db.auditEvent.create({
      data: {
        teamId,
        actorType: "USER",
        actorUserId: clerkUserId,
        actorAddress: walletAddress,
        action,
        resourceType,
        resourceId,
        requestId,
        ip:
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          undefined,
        userAgent: request.headers.get("user-agent") || undefined,
        beforeData: toPrismaNullableJson(input.beforeData),
        afterData: toPrismaNullableJson(input.afterData),
        metadata: toPrismaNullableJson(input.metadata),
      },
    });
  } catch (err) {
    // Never break primary request flow for audit write failures.
    console.error("[audit] failed to write audit event", err);
  }
}
