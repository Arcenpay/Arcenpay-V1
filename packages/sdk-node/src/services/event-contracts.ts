// ============================================================
//  @arcenpay/node — Typed Protocol Event Contracts
//  Canonical event names + idempotency helpers shared by services.
// ============================================================

export const PROTOCOL_EVENT_SCHEMA_VERSION = "2026-03-09.1";

export type ProtocolEventName =
  | "subscription.minted"
  | "subscription.renewed"
  | "subscription.renewal_failed"
  | "subscription.cancelled"
  | "proof.generated"
  | "proof.submitted"
  | "proof.settled"
  | "invoice.issued"
  | "invoice.delivery_failed"
  | "invoice.paid";

export type ProtocolEventSource =
  | "facilitator"
  | "dashboard"
  | "contracts"
  | "ops";

export interface ProtocolEvent<TPayload = Record<string, unknown>> {
  schemaVersion: string;
  name: ProtocolEventName;
  source: ProtocolEventSource;
  occurredAt: string;
  idempotencyKey: string;
  chainId?: number;
  payload: TPayload;
}

function normalizePart(value: string): string {
  return value.trim().replace(/\s+/g, "_").replace(/[:/]/g, "-");
}

export function buildEventIdempotencyKey(
  name: ProtocolEventName,
  uniqueParts: Array<string | number | bigint>,
): string {
  const suffix = uniqueParts
    .map((part) => normalizePart(String(part)))
    .filter(Boolean)
    .join(":");
  return suffix ? `${name}:${suffix}` : name;
}

export function createProtocolEvent<TPayload>(
  name: ProtocolEventName,
  payload: TPayload,
  options: {
    source: ProtocolEventSource;
    idempotencyKey: string;
    chainId?: number;
    occurredAt?: string | number | Date;
  },
): ProtocolEvent<TPayload> {
  const occurred =
    options.occurredAt instanceof Date
      ? options.occurredAt.toISOString()
      : typeof options.occurredAt === "number"
        ? new Date(options.occurredAt).toISOString()
        : options.occurredAt || new Date().toISOString();

  return {
    schemaVersion: PROTOCOL_EVENT_SCHEMA_VERSION,
    name,
    source: options.source,
    idempotencyKey: options.idempotencyKey,
    chainId: options.chainId,
    occurredAt: occurred,
    payload,
  };
}

export function mapProtocolEventToBillingType(
  name: ProtocolEventName,
):
  | "SUBSCRIPTION_MINTED"
  | "SUBSCRIPTION_RENEWED"
  | "SUBSCRIPTION_CANCELLED"
  | "PAYMENT_FAILED" {
  switch (name) {
    case "subscription.minted":
      return "SUBSCRIPTION_MINTED";
    case "subscription.renewed":
      return "SUBSCRIPTION_RENEWED";
    case "subscription.renewal_failed":
      return "PAYMENT_FAILED";
    case "subscription.cancelled":
      return "SUBSCRIPTION_CANCELLED";
    default:
      throw new Error(
        `[mapProtocolEventToBillingType] Unsupported event name for billing bridge: ${name}`,
      );
  }
}
