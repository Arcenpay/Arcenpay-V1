export interface CanonicalWebhookEventDefinition {
  id: string;
  label: string;
  description: string;
}

export const CANONICAL_WEBHOOK_EVENTS: CanonicalWebhookEventDefinition[] = [
  {
    id: "company.created",
    label: "Company Created",
    description: "When a company record is auto-created or identified for your workspace.",
  },
  {
    id: "user.created",
    label: "User Created",
    description: "When a user record is auto-created or identified for a company.",
  },
  {
    id: "company.plan.changed",
    label: "Plan Changed",
    description: "When a company is assigned to a new plan after activation or an admin update.",
  },
  {
    id: "company.plan.cancelled",
    label: "Plan Cancelled",
    description: "When a company's subscription is cancelled or removed.",
  },
  {
    id: "subscription.minted",
    label: "Subscription Minted",
    description: "When a new on-chain subscription is minted successfully.",
  },
  {
    id: "subscription.renewed",
    label: "Subscription Renewed",
    description: "When an existing on-chain subscription renews successfully.",
  },
  {
    id: "subscription.auto_renewed",
    label: "Auto Renewed",
    description: "When the renewal keeper successfully completes an automated renewal.",
  },
  {
    id: "subscription.renewal_failed",
    label: "Renewal Failed",
    description: "When an automated renewal attempt fails.",
  },
  {
    id: "invoice.issued",
    label: "Invoice Issued",
    description: "When an invoice is created for a subscription charge or manual billing event.",
  },
  {
    id: "invoice.delivery_failed",
    label: "Invoice Delivery Failed",
    description: "When an invoice email cannot be delivered to the customer.",
  },
  {
    id: "invoice.paid",
    label: "Invoice Paid",
    description: "When an issued invoice is marked as paid.",
  },
];

export const CANONICAL_WEBHOOK_EVENT_IDS = CANONICAL_WEBHOOK_EVENTS.map(
  (event) => event.id,
);
