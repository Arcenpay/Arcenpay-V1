export type PaymentLinkCheckoutAppearance = {
  title: string;
  description: string;
  brandName: string;
  recipientName: string;
  buttonLabel: string;
  accentColor: string;
  logoUrl: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readColor(value: unknown): string {
  const color = readString(value);
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : "";
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([, entry]) => {
    if (entry === null || entry === undefined) return false;
    if (typeof entry === "string") return entry.trim().length > 0;
    if (typeof entry === "object" && !Array.isArray(entry)) {
      return Object.keys(entry as Record<string, unknown>).length > 0;
    }
    return true;
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function readPaymentLinkCheckoutAppearance(
  metadata: unknown,
): PaymentLinkCheckoutAppearance {
  const root = asRecord(metadata);
  const checkoutPage = asRecord(root.checkoutPage);

  const readField = (key: keyof PaymentLinkCheckoutAppearance) =>
    readString(checkoutPage[key]) || readString(root[key]);

  return {
    title: readField("title"),
    description: readField("description"),
    brandName: readField("brandName"),
    recipientName: readField("recipientName"),
    buttonLabel: readField("buttonLabel"),
    accentColor:
      readColor(checkoutPage.accentColor) || readColor(root.accentColor),
    logoUrl: readField("logoUrl"),
  };
}

export function mergePaymentLinkCheckoutAppearance(
  metadata: unknown,
  appearance: Partial<PaymentLinkCheckoutAppearance>,
): Record<string, unknown> | undefined {
  const root = asRecord(metadata);
  const checkoutPage = { ...asRecord(root.checkoutPage) };

  const setField = (
    key: keyof PaymentLinkCheckoutAppearance,
    value: string | undefined,
  ) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized) {
      checkoutPage[key] = normalized;
      return;
    }
    delete checkoutPage[key];
  };

  setField("title", appearance.title);
  setField("description", appearance.description);
  setField("brandName", appearance.brandName);
  setField("recipientName", appearance.recipientName);
  setField("buttonLabel", appearance.buttonLabel);
  setField("logoUrl", appearance.logoUrl);

  if (appearance.accentColor !== undefined) {
    const normalizedColor = readColor(appearance.accentColor);
    if (normalizedColor) {
      checkoutPage.accentColor = normalizedColor;
    } else {
      delete checkoutPage.accentColor;
    }
  }

  const nextRoot = { ...root };
  const compactCheckoutPage = compactRecord(checkoutPage);
  if (compactCheckoutPage) {
    nextRoot.checkoutPage = compactCheckoutPage;
  } else {
    delete nextRoot.checkoutPage;
  }

  return compactRecord(nextRoot);
}
