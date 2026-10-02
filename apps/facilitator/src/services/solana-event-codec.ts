// ============================================================
//  ArcenPay Facilitator — Solana / Anchor EVENT codec
//
//  Decodes Anchor `emit!` events from `Program data: <base64>` log
//  lines: 8-byte sha256("event:<Name>") discriminator + Borsh body.
//
//  Account decoders (Plan/Config/Session/Subscription) and the Borsh
//  reader now live in `@arcenpay/internal-core/solana`; they are
//  re-exported here for existing facilitator imports.
//
//  Field order MUST match packages/solana-programs — reordering there
//  silently breaks this decoder.
// ============================================================

import { createHash } from "node:crypto";
import {
  BorshReader,
  decodeConfigRecord,
  decodePlanRecord,
  decodeSessionRecord,
  decodeSubscriptionByWallet,
  decodeSubscriptionRecord,
  u64le,
} from "@arcenpay/internal-core/solana";
import type {
  NormalisedSubscriptionEventType,
  NormalisedSubscriptionEvent,
} from "./chain-adapter.js";

export { u64le, BorshReader };
export {
  decodeConfigRecord,
  decodePlanRecord,
  decodeSessionRecord,
  decodeSubscriptionByWallet,
  decodeSubscriptionRecord,
};

export const PROGRAM_DATA_LOG_PREFIX = "Program data: ";

const EVENT_NAMES: Record<string, NormalisedSubscriptionEventType> = {
  SubscriptionMinted: "minted",
  SubscriptionRenewed: "renewed",
  SubscriptionCancelled: "cancelled",
  SubscriptionPlanChanged: "plan_changed",
  BillingExecuted: "billing_executed",
  BillingSettled: "billing_settled",
};

/** discriminator(hex) → normalised event type. */
export const EVENT_DISCRIMINATORS: Map<string, NormalisedSubscriptionEventType> =
  (() => {
    const map = new Map<string, NormalisedSubscriptionEventType>();
    for (const [name, type] of Object.entries(EVENT_NAMES)) {
      const digest = createHash("sha256").update(`event:${name}`).digest();
      map.set(digest.subarray(0, 8).toString("hex"), type);
    }
    return map;
  })();

export interface EventBase {
  signature: string;
  slot: string;
  timestamp: number;
}

/**
 * Decodes a full Anchor event payload (discriminator + Borsh body).
 * Returns null for unknown discriminators or malformed bodies.
 */
export function decodeAnchorEventPayload(
  payload: Buffer,
  base: EventBase,
): NormalisedSubscriptionEvent | null {
  if (payload.length < 8) return null;
  const type = EVENT_DISCRIMINATORS.get(payload.subarray(0, 8).toString("hex"));
  if (!type) return null;
  return decodeAnchorEventBody(type, payload.subarray(8), base);
}

/**
 * Decodes an Anchor event body (without the 8-byte discriminator) for a
 * known event type.
 */
export function decodeAnchorEventBody(
  type: NormalisedSubscriptionEventType,
  body: Buffer,
  base: EventBase,
): NormalisedSubscriptionEvent | null {
  try {
    const r = new BorshReader(body);
    const event: NormalisedSubscriptionEvent = {
      type,
      tokenId: "0",
      transactionHash: base.signature,
      blockNumber: base.slot,
      timestamp: base.timestamp,
    };

    switch (type) {
      case "minted": {
        event.subscriber = r.pubkey();
        event.tokenId = r.u64().toString();
        event.planId = r.u64().toString();
        event.expiration = Number(r.i64());
        break;
      }
      case "renewed": {
        event.tokenId = r.u64().toString();
        event.expiration = Number(r.i64());
        event.amountPaidMicros = r.u64().toString();
        break;
      }
      case "cancelled": {
        event.tokenId = r.u64().toString();
        break;
      }
      case "plan_changed": {
        event.tokenId = r.u64().toString();
        event.previousPlanId = r.u64().toString();
        event.planId = r.u64().toString();
        event.expiration = Number(r.i64());
        break;
      }
      case "billing_executed": {
        event.account = r.pubkey();
        event.merchant = r.pubkey();
        event.tokenId = r.u64().toString();
        event.planId = r.u64().toString();
        event.billingReason = r.u8();
        event.amountPaidMicros = r.u64().toString();
        event.merchantAmountMicros = r.u64().toString();
        event.protocolFeeMicros = r.u64().toString();
        event.timestamp = Number(r.i64());
        break;
      }
      case "billing_settled": {
        event.tokenId = r.u64().toString(); // session_id
        event.account = r.pubkey(); // agent
        event.callCount = Number(r.u64());
        event.amountPaidMicros = r.u64().toString();
        r.i64(); // window_start
        r.i64(); // window_end
        break;
      }
      default:
        return null;
    }

    return event;
  } catch {
    return null;
  }
}
