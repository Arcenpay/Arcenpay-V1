import {
  createCheckoutSession,
  getCheckoutSessionById,
  updateCheckoutSessionCustomerDetails,
  confirmCheckoutSessionPayment,
} from '../lib/payments/checkout-sessions';
import {
  createPaymentLink,
  listPaymentLinks,
  getPaymentLinkById,
  getPaymentLinkBySlug,
  updatePaymentLink,
} from '../lib/payments/payment-links';

export class CheckoutError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

export class CheckoutService {
  // ── Checkout Sessions ──────────────────────────────────────────────────────

  async createCheckoutSession(
    input: Parameters<typeof createCheckoutSession>[0],
  ) {
    try {
      return await createCheckoutSession(input);
    } catch (error) {
      throw new CheckoutError(
        error instanceof Error ? error.message : "Failed to create checkout session",
        500,
        "CHECKOUT_SESSION_CREATE_FAILED",
      );
    }
  }

  async getCheckoutSessionById(id: string, teamId?: string) {
    return getCheckoutSessionById(id, teamId);
  }

  async updateCheckoutSessionCustomerDetails(
    input: Parameters<typeof updateCheckoutSessionCustomerDetails>[0],
  ) {
    try {
      return await updateCheckoutSessionCustomerDetails(input);
    } catch (error) {
      throw new CheckoutError(
        error instanceof Error ? error.message : "Failed to update checkout session",
        500,
        "CHECKOUT_SESSION_UPDATE_FAILED",
      );
    }
  }

  async confirmCheckoutSessionPayment(
    input: Parameters<typeof confirmCheckoutSessionPayment>[0],
  ) {
    try {
      return await confirmCheckoutSessionPayment(input);
    } catch (error) {
      throw new CheckoutError(
        error instanceof Error ? error.message : "Failed to confirm checkout payment",
        500,
        "CHECKOUT_PAYMENT_CONFIRM_FAILED",
      );
    }
  }

  // ── Payment Links ──────────────────────────────────────────────────────────

  async createPaymentLink(
    input: Parameters<typeof createPaymentLink>[0],
  ) {
    try {
      return await createPaymentLink(input);
    } catch (error) {
      throw new CheckoutError(
        error instanceof Error ? error.message : "Failed to create payment link",
        500,
        "PAYMENT_LINK_CREATE_FAILED",
      );
    }
  }

  async listPaymentLinks(teamId: string) {
    return listPaymentLinks(teamId);
  }

  async getPaymentLinkById(teamId: string, id: string) {
    return getPaymentLinkById(teamId, id);
  }

  async getPaymentLinkBySlug(slug: string) {
    return getPaymentLinkBySlug(slug);
  }

  async updatePaymentLink(
    input: Parameters<typeof updatePaymentLink>[0],
  ) {
    try {
      return await updatePaymentLink(input);
    } catch (error) {
      throw new CheckoutError(
        error instanceof Error ? error.message : "Failed to update payment link",
        500,
        "PAYMENT_LINK_UPDATE_FAILED",
      );
    }
  }
}

export const checkoutService = new CheckoutService();
