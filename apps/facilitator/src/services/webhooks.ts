// ============================================================
//  @arcenpay/node — Webhook Delivery Service
//  HMAC-SHA256 signed webhook delivery with retry queue
//  PRD §9.3 — Provider Webhook System
// ============================================================

import { createHmac, timingSafeEqual } from "crypto";
import type { SubscriptionEventData } from "./events.js";

function resolveWebhookEventName(event: SubscriptionEventData): string {
  switch (event.type) {
    case "minted":
      return "subscription.minted";
    case "renewed":
      return "subscription.renewed";
    case "cancelled":
      return "subscription.cancelled";
    case "plan_changed":
      return "subscription.plan_changed";
    case "billing_executed": {
      const billingReason = Number(event.billingReason ?? 0n);
      return billingReason === 0
        ? "subscription.minted"
        : "subscription.renewed";
    }
    default:
      return `subscription.${event.type}`;
  }
}

export interface WebhookConfig {
  /** Provider-configured webhook endpoint URL */
  url: string;
  /** HMAC-SHA256 signing secret */
  secret: string;
  /** Max retries (default: 5) */
  maxRetries?: number;
  /** Retry delays in ms (exponential backoff) */
  retryDelays?: number[];
  /** Optional callback invoked on every delivery attempt (success or failure). */
  onDelivery?: (
    entry: WebhookDeliveryLog,
    payload: WebhookPayload,
  ) => Promise<void> | void;
}

export interface WebhookPayload {
  event: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface WebhookDeliveryLog {
  id: string;
  event: string;
  url: string;
  statusCode: number | null;
  attemptNumber: number;
  deliveredAt: number;
  success: boolean;
  error?: string;
}

const DEFAULT_RETRY_DELAYS = [1000, 5000, 30000, 300000, 1800000]; // 1s, 5s, 30s, 5min, 30min

/**
 * WebhookService — Delivers HMAC-signed webhook payloads
 * to provider-configured endpoints with exponential backoff retry.
 *
 * Payload format:
 *   { event: 'subscription.renewed', timestamp, data: { tokenId, address, planId, amount, txHash } }
 *
 * Signing:
 *   HMAC-SHA256(JSON.stringify(payload), signingSecret) → X-ArcenPay-Signature header
 */
export class WebhookService {
  private config: Required<Omit<WebhookConfig, "onDelivery">> &
    Pick<WebhookConfig, "onDelivery">;
  private deliveryLog: WebhookDeliveryLog[] = [];
  private pendingRetries: Map<string, ReturnType<typeof setTimeout>> =
    new Map();

  constructor(config: WebhookConfig) {
    this.config = {
      maxRetries: 5,
      retryDelays: DEFAULT_RETRY_DELAYS,
      ...config,
    };
  }

  /**
   * Deliver a webhook for a subscription event
   */
  async deliverEvent(event: SubscriptionEventData): Promise<void> {
    const canonicalEvent = resolveWebhookEventName(event);
    const payload: WebhookPayload = {
      event: canonicalEvent,
      timestamp: event.timestamp,
      data: {
        tokenId: event.tokenId?.toString(),
        subscriber: event.subscriber,
        planId: event.planId?.toString(),
        expiration: event.expiration?.toString(),
        amountPaid: event.amountPaid?.toString(),
        txHash: event.transactionHash,
        blockNumber: event.blockNumber?.toString(),
      },
    };

    await this.deliver(payload);
  }

  /**
   * Deliver an arbitrary webhook payload
   */
  async deliver(payload: WebhookPayload, attempt = 1): Promise<void> {
    const id = `${payload.event}-${payload.timestamp}-${attempt}`;
    const body = JSON.stringify(payload);
    const signature = this.sign(body);

    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ArcenPay-Signature": signature,
          "X-ArcenPay-Delivery": id,
          "X-ArcenPay-Event": payload.event,
          "X-ArcenPay-Timestamp": String(payload.timestamp),
          "User-Agent": "ArcenPay-Webhook/1.0",
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      this.log({
        id,
        event: payload.event,
        url: this.config.url,
        statusCode: response.status,
        attemptNumber: attempt,
        deliveredAt: Date.now(),
        success: response.ok,
      });
      await this.persistDelivery(
        this.deliveryLog[this.deliveryLog.length - 1],
        payload,
      );

      if (!response.ok && attempt < this.config.maxRetries) {
        await this.scheduleRetry(payload, attempt);
      }
    } catch (err: any) {
      this.log({
        id,
        event: payload.event,
        url: this.config.url,
        statusCode: null,
        attemptNumber: attempt,
        deliveredAt: Date.now(),
        success: false,
        error: err.message,
      });
      await this.persistDelivery(
        this.deliveryLog[this.deliveryLog.length - 1],
        payload,
      );

      if (attempt < this.config.maxRetries) {
        await this.scheduleRetry(payload, attempt);
      }
    }
  }

  /**
   * HMAC-SHA256 signature of the payload body
   */
  private sign(body: string): string {
    return createHmac("sha256", this.config.secret).update(body).digest("hex");
  }

  /**
   * Schedule a retry with exponential backoff
   */
  private async scheduleRetry(
    payload: WebhookPayload,
    currentAttempt: number,
  ): Promise<void> {
    const delay = this.config.retryDelays[currentAttempt - 1] || 1800000;
    const retryId = `retry-${payload.event}-${currentAttempt}`;

    console.log(
      `[Webhook] Scheduling retry ${currentAttempt + 1} in ${delay}ms for ${payload.event}`,
    );

    const timer = setTimeout(() => {
      this.deliver(payload, currentAttempt + 1);
      this.pendingRetries.delete(retryId);
    }, delay);

    this.pendingRetries.set(retryId, timer);
  }

  /**
   * Log a delivery attempt
   */
  private log(entry: WebhookDeliveryLog): void {
    this.deliveryLog.push(entry);
    // Keep only last 1000 entries
    if (this.deliveryLog.length > 1000) {
      this.deliveryLog = this.deliveryLog.slice(-500);
    }
    console.log(
      `[Webhook] ${entry.success ? "✅" : "❌"} ${entry.event} → ${entry.statusCode} (attempt ${entry.attemptNumber})`,
    );
  }

  private async persistDelivery(
    entry: WebhookDeliveryLog | undefined,
    payload: WebhookPayload,
  ): Promise<void> {
    if (!entry || !this.config.onDelivery) return;
    try {
      await this.config.onDelivery(entry, payload);
    } catch (err) {
      console.error("[Webhook] onDelivery callback failed:", err);
    }
  }

  /**
   * Get the delivery log for dashboard display
   */
  getDeliveryLog(limit = 50): WebhookDeliveryLog[] {
    return this.deliveryLog.slice(-limit).reverse();
  }

  /**
   * Verify an incoming webhook signature (for consumers).
   *
   * SECURITY: inputs are type-checked and the comparison is constant-time. A
   * malformed `X-ArcenPay-Signature` must yield `false`, never throw — a throw
   * inside a consumer's webhook handler turns one crafted request into a 500
   * (denial of service) instead of a clean 401.
   *
   * Always verify against the RAW body. Passing `JSON.stringify(req.body)`
   * changes whitespace and key order and will not match the signature.
   *
   * @example
   * ```ts
   * import { verifyWebhookSignature } from '@arcenpay/node';
   *
   * app.post('/webhooks/arcenpay', (req, res) => {
   *   const raw = req.rawBody ?? JSON.stringify(req.body);
   *   const sig = req.headers['x-arcenpay-signature'];
   *   if (!verifyWebhookSignature(raw, sig, process.env.ARCENPAY_WEBHOOK_SECRET)) {
   *     return res.status(401).json({ error: 'Invalid signature' });
   *   }
   * });
   * ```
   */
  static verifySignature(
    body: unknown,
    signature: unknown,
    secret: unknown,
  ): boolean {
    if (typeof body !== "string") return false;
    if (typeof signature !== "string") return false;
    if (typeof secret !== "string") return false;

    const normalizedSecret = secret.trim();
    const normalizedSignature = signature
      .trim()
      .replace(/^sha256=/i, "")
      .toLowerCase();

    if (!normalizedSecret) return false;
    if (!/^[0-9a-f]{64}$/.test(normalizedSignature)) return false;

    const expected = Buffer.from(
      createHmac("sha256", normalizedSecret).update(body).digest("hex"),
      "hex",
    );
    const received = Buffer.from(normalizedSignature, "hex");

    return (
      expected.length === received.length &&
      timingSafeEqual(expected, received)
    );
  }

  /**
   * Cancel all pending retries and clean up
   */
  stop(): void {
    for (const timer of this.pendingRetries.values()) {
      clearTimeout(timer);
    }
    this.pendingRetries.clear();
  }
}

/**
 * Standalone helper for verifying incoming ArcenPay webhook signatures.
 * Equivalent to `WebhookService.verifySignature()` — exported for tree-shaking convenience.
 *
 * @param body      - Raw request body string (before any JSON.parse)
 * @param signature - Value from the `X-ArcenPay-Signature` request header
 * @param secret    - Shared HMAC signing secret configured on the provider's webhook endpoint
 */
export function verifyWebhookSignature(
  body: unknown,
  signature: unknown,
  secret: unknown,
): boolean {
  return WebhookService.verifySignature(body, signature, secret);
}
