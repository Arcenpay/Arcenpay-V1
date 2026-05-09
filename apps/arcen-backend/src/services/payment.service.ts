import {
  verifyDirectErc20Transfer,
  verifyAutopayPlanChange,
  verifySubscriptionRegistryPlanChange,
  verifyAutopayCancellationControl,
  verifySubscriptionCancellation,
  normalizeTxHash,
  decimalToAtomicUnits,
  type VerifyDirectErc20TransferInput,
  type VerifyDirectErc20TransferResult,
  type VerifyAutopayPlanChangeInput,
  type VerifyAutopayPlanChangeResult,
  type VerifySubscriptionRegistryPlanChangeInput,
  type VerifySubscriptionRegistryPlanChangeResult,
  type VerifyAutopayCancellationControlInput,
  type VerifyAutopayCancellationControlResult,
  type VerifySubscriptionCancellationInput,
  type VerifySubscriptionCancellationResult,
} from '../lib/payments/onchain-payment-verification';

export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export class PaymentService {
  // ── Direct ERC-20 Transfer Verification ───────────────────────────────────

  async verifyDirectErc20Transfer(
    params: VerifyDirectErc20TransferInput,
  ): Promise<VerifyDirectErc20TransferResult> {
    return verifyDirectErc20Transfer(params);
  }

  // ── Autopay Plan Change Verification ──────────────────────────────────────

  async verifyAutopayPlanChange(
    params: VerifyAutopayPlanChangeInput,
  ): Promise<VerifyAutopayPlanChangeResult> {
    return verifyAutopayPlanChange(params);
  }

  // ── Subscription Registry Plan Change ─────────────────────────────────────

  async verifySubscriptionRegistryPlanChange(
    params: VerifySubscriptionRegistryPlanChangeInput,
  ): Promise<VerifySubscriptionRegistryPlanChangeResult> {
    return verifySubscriptionRegistryPlanChange(params);
  }

  // ── Autopay Cancellation Control ──────────────────────────────────────────

  async verifyAutopayCancellationControl(
    params: VerifyAutopayCancellationControlInput,
  ): Promise<VerifyAutopayCancellationControlResult> {
    return verifyAutopayCancellationControl(params);
  }

  // ── Subscription Cancellation ──────────────────────────────────────────────

  async verifySubscriptionCancellation(
    params: VerifySubscriptionCancellationInput,
  ): Promise<VerifySubscriptionCancellationResult> {
    return verifySubscriptionCancellation(params);
  }

  // ── Utility Helpers ────────────────────────────────────────────────────────

  normalizeTxHash(value?: string | null): `0x${string}` | null {
    return normalizeTxHash(value);
  }

  decimalToAtomicUnits(value: string, decimals?: number): bigint {
    return decimalToAtomicUnits(value, decimals);
  }
}

export const paymentService = new PaymentService();
