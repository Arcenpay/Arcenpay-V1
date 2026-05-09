import {
  ingestBillingEvent,
  resolveBillingRecipientEmail,
  resolveCanonicalBillingEventName,
  createIssuedChargeInvoice,
  type PersistBillingEventInput,
  type BillingRecipientLookupInput,
  type CreateChargeInvoiceInput,
} from '../lib/billing/billing-events';
import {
  runBillingMaintenance,
  runBillingMaintenanceForAllTeams,
  applyScheduledSubscriptionTransitions,
} from '../lib/billing/billing-maintenance';
import {
  shouldEnforceDunning,
  runBillingDunningSweep,
} from '../lib/billing/billing-dunning';
import {
  upsertSubscriptionLedgerState,
  recordSuccessfulPayment,
  recordFailedPayment,
} from '../lib/billing/billing-ledger';
import {
  enqueueSubscriptionActivationRecovery,
  finalizeSubscriptionActivation,
  processBillingRecoveryTask,
  processPendingBillingRecoveryTasks,
  computeBillingRecoveryNextAttemptAt,
  type FinalizeSubscriptionActivationInput,
} from '../lib/billing/billing-recovery';

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export class BillingService {
  // ── Billing Events ──────────────────────────────────────────────────────────

  async ingestBillingEvent(input: PersistBillingEventInput) {
    try {
      return await ingestBillingEvent(input);
    } catch (error) {
      throw new BillingError(
        error instanceof Error ? error.message : "Failed to ingest billing event",
        500,
        "BILLING_EVENT_INGEST_FAILED",
      );
    }
  }

  async resolveBillingRecipientEmail(input: BillingRecipientLookupInput) {
    return resolveBillingRecipientEmail(input);
  }

  resolveCanonicalBillingEventName(
    eventType: Parameters<typeof resolveCanonicalBillingEventName>[0],
    eventName?: string,
  ) {
    return resolveCanonicalBillingEventName(eventType, eventName);
  }

  async createIssuedChargeInvoice(input: CreateChargeInvoiceInput) {
    return createIssuedChargeInvoice(input);
  }

  // ── Billing Maintenance ────────────────────────────────────────────────────

  async runBillingMaintenance(input: { teamId: string; executeDunning?: boolean; limit?: number; now?: Date }) {
    try {
      return await runBillingMaintenance(input);
    } catch (error) {
      throw new BillingError(
        error instanceof Error ? error.message : "Billing maintenance failed",
        500,
        "BILLING_MAINTENANCE_FAILED",
      );
    }
  }

  async runBillingMaintenanceForAllTeams(input?: { executeDunning?: boolean; limitPerTeam?: number; teamLimit?: number; now?: Date }) {
    try {
      return await runBillingMaintenanceForAllTeams(input);
    } catch (error) {
      throw new BillingError(
        error instanceof Error ? error.message : "Billing maintenance for all teams failed",
        500,
        "BILLING_MAINTENANCE_ALL_FAILED",
      );
    }
  }

  async applyScheduledSubscriptionTransitions(input: { teamId: string; limit?: number; now?: Date }) {
    return applyScheduledSubscriptionTransitions(input);
  }

  // ── Billing Dunning ────────────────────────────────────────────────────────

  shouldEnforceDunning(input: { status: "ACTIVE" | "PAST_DUE" | "CANCELLED"; graceEndsAt?: Date | null; now?: Date }) {
    return shouldEnforceDunning(input);
  }

  async runBillingDunningSweep(options?: { now?: Date; teamId?: string; limit?: number }) {
    try {
      return await runBillingDunningSweep(options);
    } catch (error) {
      throw new BillingError(
        error instanceof Error ? error.message : "Dunning sweep failed",
        500,
        "DUNNING_SWEEP_FAILED",
      );
    }
  }

  // ── Billing Ledger ─────────────────────────────────────────────────────────

  async upsertSubscriptionLedgerState(
    input: Parameters<typeof upsertSubscriptionLedgerState>[0],
  ) {
    return upsertSubscriptionLedgerState(input);
  }

  async recordSuccessfulPayment(
    input: Parameters<typeof recordSuccessfulPayment>[0],
  ) {
    return recordSuccessfulPayment(input);
  }

  async recordFailedPayment(
    input: Parameters<typeof recordFailedPayment>[0],
  ) {
    return recordFailedPayment(input);
  }

  // ── Billing Recovery ───────────────────────────────────────────────────────

  async enqueueSubscriptionActivationRecovery(
    input: Parameters<typeof enqueueSubscriptionActivationRecovery>[0],
  ) {
    return enqueueSubscriptionActivationRecovery(input);
  }

  async finalizeSubscriptionActivation(input: FinalizeSubscriptionActivationInput) {
    try {
      return await finalizeSubscriptionActivation(input);
    } catch (error) {
      throw new BillingError(
        error instanceof Error ? error.message : "Failed to finalize subscription activation",
        500,
        "RECOVERY_FINALIZE_FAILED",
      );
    }
  }

  async processBillingRecoveryTask(input: { taskId: string; now?: Date }) {
    return processBillingRecoveryTask(input);
  }

  async processPendingBillingRecoveryTasks(input: { teamId: string; now?: Date; limit?: number }) {
    return processPendingBillingRecoveryTasks(input);
  }

  computeBillingRecoveryNextAttemptAt(attemptCount: number, now: Date) {
    return computeBillingRecoveryNextAttemptAt(attemptCount, now);
  }
}

export const billingService = new BillingService();
