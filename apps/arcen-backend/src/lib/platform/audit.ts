import { db } from "../../db.js";
import { toPrismaNullableJson } from "../../utils/prisma-json.js";

export type AuditHeaders = {
  get(name: string): string | null | undefined;
};

export type AuditInput = {
  headers: AuditHeaders;
  teamId: string;
  userId?: string;
  walletAddress?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: unknown;
};

export function buildRequestId(headers: AuditHeaders): string {
  return (
    headers.get("x-request-id") ||
    headers.get("x-correlation-id") ||
    crypto.randomUUID()
  );
}

export async function writeAuditEvent(input: AuditInput): Promise<void> {
  const {
    headers,
    teamId,
    userId,
    walletAddress,
    action,
    resourceType,
    resourceId,
  } = input;
  const requestId = buildRequestId(headers);

  try {
    await db.auditEvent.create({
      data: {
        teamId,
        actorType: "USER",
        actorUserId: userId,
        actorAddress: walletAddress,
        action,
        resourceType,
        resourceId,
        requestId,
        ip:
          headers.get("x-forwarded-for") ||
          headers.get("x-real-ip") ||
          undefined,
        userAgent: headers.get("user-agent") || undefined,
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
