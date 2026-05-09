import {
  sendWebhookDelivery,
  deliverWebhook,
  type SendWebhookDeliveryInput,
  type SendWebhookDeliveryResult,
} from '../lib/webhooks/deliver-webhook';

export class WebhookError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "WebhookError";
  }
}

export class WebhookService {
  async sendWebhookDelivery(
    input: SendWebhookDeliveryInput,
  ): Promise<SendWebhookDeliveryResult | null> {
    try {
      return await sendWebhookDelivery(input);
    } catch (error) {
      throw new WebhookError(
        error instanceof Error ? error.message : "Failed to send webhook delivery",
        502,
        "WEBHOOK_DELIVERY_FAILED",
      );
    }
  }

  async deliverWebhook(
    teamId: string,
    eventName: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await deliverWebhook(teamId, eventName, data);
    } catch (error) {
      throw new WebhookError(
        error instanceof Error ? error.message : "Failed to deliver webhook",
        502,
        "WEBHOOK_DELIVERY_FAILED",
      );
    }
  }
}

export const webhookService = new WebhookService();
