export const GA_MEASUREMENT_ID = (process.env.NEXT_PUBLIC_GA_ID || "").trim();

export type AnalyticsParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const ALLOWED_PARAMS = new Set([
  "plan_id",
  "chain_family",
  "environment",
  "amount_usd",
]);

function sanitizeParams(params?: AnalyticsParams): AnalyticsParams {
  const sanitized: AnalyticsParams = {};
  if (!params) return sanitized;
  for (const [key, value] of Object.entries(params)) {
    if (ALLOWED_PARAMS.has(key)) sanitized[key] = value;
  }
  return sanitized;
}

export function trackEvent(name: string, params?: AnalyticsParams): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", name, sanitizeParams(params));
}

export function trackSignUp(params?: AnalyticsParams): void {
  trackEvent("sign_up", params);
}

export function trackLogin(params?: AnalyticsParams): void {
  trackEvent("login", params);
}

export function trackPlanViewed(params?: AnalyticsParams): void {
  trackEvent("plan_viewed", params);
}

export function trackSubscribeStarted(params?: AnalyticsParams): void {
  trackEvent("subscribe_started", params);
}

export function trackSubscribeSuccess(params?: AnalyticsParams): void {
  trackEvent("subscribe_success", params);
}

export function trackSubscribeFailed(params?: AnalyticsParams): void {
  trackEvent("subscribe_failed", params);
}

export function trackCancelStarted(params?: AnalyticsParams): void {
  trackEvent("cancel_started", params);
}

export function trackCancelCompleted(params?: AnalyticsParams): void {
  trackEvent("cancel_completed", params);
}

export function trackInvoiceDownloaded(params?: AnalyticsParams): void {
  trackEvent("invoice_downloaded", params);
}
