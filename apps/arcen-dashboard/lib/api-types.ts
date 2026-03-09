// ============================================================
//  Dashboard — Shared API Response Types
//
//  Standard response envelopes used across all dashboard APIs.
//  Importing these in client code prevents per-call shape drift
//  and makes GA-level API contracts explicit.
//
//  Phase 7 — Lock API response shapes before GA.
// ============================================================

// ── Generic envelopes ─────────────────────────────────────────

/** Success response with an optional data payload */
export interface ApiOk<T = undefined> {
  ok: true;
  data?: T;
}

/** Error response */
export interface ApiError {
  error: string;
  details?: Record<string, string[]>;
}

/** Paginated list response */
export interface ApiList<T> {
  items: T[];
  count: number;
  /** Present when more items exist beyond this page */
  nextCursor?: string;
}

// ── Billing events ────────────────────────────────────────────

export interface BillingEventShape {
  id: string;
  eventType:
    | "SUBSCRIPTION_MINTED"
    | "SUBSCRIPTION_RENEWED"
    | "SUBSCRIPTION_CANCELLED"
    | "PAYMENT_FAILED"
    | "CREDIT_ISSUED";
  eventName?:
    | "subscription.minted"
    | "subscription.renewed"
    | "subscription.cancelled"
    | "proof.generated"
    | "proof.submitted"
    | "proof.settled"
    | "invoice.issued"
    | "invoice.delivery_failed"
    | "invoice.paid";
  schemaVersion?: string;
  occurredAt?: string;
  idempotencyKey: string;
  source: string;
  processed: boolean;
  processedAt: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
  invoiceId: string | null;
}

// ── Invoice ───────────────────────────────────────────────────

export type InvoiceStatus = "DRAFT" | "ISSUED" | "PAID" | "VOID" | "OVERDUE";
export type EnvironmentMode = "DEVELOPMENT" | "PRODUCTION";

export interface InvoiceLineShape {
  id: string;
  description: string;
  quantity: number;
  unitAmount: string;
  taxRate: string;
  lineSubtotal: string;
  lineTax: string;
  lineTotal: string;
}

export interface InvoiceDeliveryShape {
  id: string;
  provider: string;
  method: string;
  status: "PENDING" | "SENT" | "FAILED";
  sentAt: string | null;
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface InvoiceShape {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  environmentMode: EnvironmentMode;
  currency: string;
  customerEmail: string | null;
  customerWallet: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  planId: string | null;
  metadata: Record<string, unknown> | null;
  lineItems: InvoiceLineShape[];
  deliveries: InvoiceDeliveryShape[];
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceListResponse {
  invoices: InvoiceShape[];
}

export interface InvoiceCreateResponse {
  invoice: InvoiceShape;
  downloadUrl: string;
}

// ── Catalog ───────────────────────────────────────────────────

export type ChainSyncStatus = "PENDING" | "SYNCED" | "FAILED" | "NOT_APPLICABLE";

export interface CatalogPlanShape {
  id: string;
  name: string;
  tier: string;
  chainSyncStatus: ChainSyncStatus;
  onChainPlanId: string | null;
  chainSyncError: string | null;
  /** Present when chainSyncStatus === "PENDING" */
  retryHint: string | null;
}

export interface CatalogPublishResponse {
  ok: true;
  environmentMode: EnvironmentMode;
  published: {
    plans: CatalogPlanShape[];
    addOns: Array<{ id: string; name: string; code: string; chainSyncStatus: ChainSyncStatus }>;
    credits: Array<{ id: string; name: string; code: string; chainSyncStatus: ChainSyncStatus }>;
  };
  chainSync: {
    required: boolean;
    pendingCount: number;
    pendingPlanIds: string[];
    message: string;
  };
}

// ── Ops / Worker health ───────────────────────────────────────

export interface SubgraphHealthShape {
  healthy: boolean;
  lagSeconds: number | null;
  latestBlock: number | null;
  error?: string;
}

export interface SloShape {
  ok: boolean;
  breachCount: number;
  breaches: string[];
}

export interface WorkerHealthResponse {
  healthy: boolean;
  generatedAt: string;
  facilitator:
    | {
        reachable: true;
        status: string;
        queues: unknown;
        slo: SloShape | null;
        replayProtection: unknown;
        settlement: unknown;
        blockNumber: string | null;
      }
    | { reachable: false; error: string };
  subgraph: SubgraphHealthShape;
}

// ── GA readiness ──────────────────────────────────────────────

export interface GaReadinessGate {
  id: string;
  description: string;
  passed: boolean;
  detail?: string;
}

export interface GaReadinessResponse {
  ready: boolean;
  generatedAt: string;
  teamId: string;
  totalGates: number;
  passed: number;
  failed: number;
  gates: GaReadinessGate[];
  message: string;
  failedGates?: string[];
}

// ── Audit log ────────────────────────────────────────────────

export interface AuditEventShape {
  id: string;
  teamId: string;
  actorType: string;
  actorUserId: string | null;
  actorAddress: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}
