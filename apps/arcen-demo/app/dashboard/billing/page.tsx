"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArcenEmbed, CheckoutModal } from "@arcenpay/react";
import type {
  ComponentInvoiceSummary,
  ComponentPlanEntitlement,
  ComponentPlanSummary,
  ComponentRenderData,
  ComponentUsageItem,
} from "@arcenpay/sdk";
import { formatCurrency } from "@arcenpay/sdk";
import Link from "next/link";
import styles from "./page.module.css";

interface AccessTokenResponse {
  token?: { token: string; expiresAt: string };
  error?: string;
}

interface Config {
  componentId: string;
  baseUrl: string;
  demoCompanyWallet: string;
  hasApiKey: boolean;
}

type DemoPlan = ComponentPlanSummary & {
  onChainPlanId?: string | null;
  metadata?: {
    entitlements?: ComponentPlanEntitlement[];
    [key: string]: unknown;
  } | null;
};

type DemoInvoice = ComponentInvoiceSummary & {
  downloadUrl?: string | null;
};

type SubscriptionTransition = {
  mode?: string;
  targetPlanId?: string | null;
  targetPlanName?: string | null;
  previousPlanId?: string | null;
  requestedAt?: string | null;
  effectiveAt?: string | null;
};

type DemoRenderData = Omit<
  ComponentRenderData,
  "plans" | "activePlan" | "recentInvoices"
> & {
  plans: DemoPlan[];
  activePlan: DemoPlan | null;
  recentInvoices?: DemoInvoice[];
  subscriptionTransition?: SubscriptionTransition | null;
};

async function parseJsonResponse<T>(
  response: Response,
  context: string,
): Promise<T | null> {
  const body = await response.text();
  if (!body.trim()) return null;

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${context} returned invalid JSON`);
  }
}

function formatDateLabel(value?: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatIntervalLabel(interval?: number) {
  if (!interval) return "per cycle";
  if (interval === 31_536_000) return "per year";
  if (interval === 7_776_000) return "per quarter";
  if (interval === 2_592_000) return "per month";
  return `every ${Math.round(interval / 86_400)} days`;
}

function truncateWallet(wallet?: string | null) {
  if (!wallet) return "Not connected";
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function getPlanEntitlements(plan?: DemoPlan | null) {
  if (!plan?.metadata || !Array.isArray(plan.metadata.entitlements)) return [];
  return plan.metadata.entitlements.filter(
    (entitlement) => entitlement.enabled,
  );
}

function describeEntitlement(entitlement: ComponentPlanEntitlement) {
  switch (entitlement.type) {
    case "NUMERIC":
      return `${Number(entitlement.value ?? 0).toLocaleString()} ${entitlement.featureName}`;
    case "UNLIMITED":
      return `Unlimited ${entitlement.featureName}`;
    case "BOOLEAN":
    default:
      return entitlement.featureName;
  }
}

function getUsageItems(data: DemoRenderData | null): ComponentUsageItem[] {
  if (!data) return [];
  if (data.usage.length > 0) return data.usage;

  return data.entitlements
    .filter((entitlement) => entitlement.featureType === "event_based")
    .map((entitlement) => ({
      featureKey: entitlement.featureKey,
      name: entitlement.name,
      used: entitlement.usage ?? 0,
      limit: entitlement.limit,
      unitSingular: entitlement.unitSingular ?? null,
      unitPlural: entitlement.unitPlural ?? null,
    }));
}

function formatUsageLabel(item: ComponentUsageItem) {
  const unitLabel = item.unitPlural ?? item.unitSingular ?? "uses";
  if (typeof item.limit === "number") {
    return `${item.used.toLocaleString()} / ${item.limit.toLocaleString()} ${unitLabel}`;
  }
  return `${item.used.toLocaleString()} ${unitLabel}`;
}

const INTEGRATION_CODE = `const { token } = await fetch("/api/access-token", {
  method: "POST",
}).then((r) => r.json());

const billing = await fetch(
  \`\${process.env.ARCENPAY_BASE_URL}/api/v1/components/\${process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID}/render\`,
  { headers: { Authorization: \`Bearer \${token.token}\` } },
).then((r) => r.json());

<CheckoutModal
  planId={BigInt(plan.onChainPlanId)}
  requestSubscription={async ({ planId, paymentAccount, subscriberEmail }) => {
    const response = await fetch("/api/request-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: planId.toString(),
        paymentAccount,
        subscriberEmail,
      }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Activation failed");
    return result;
  }}
/>

<ArcenEmbed
  accessToken={token.token}
  componentId={process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID}
  baseUrl={process.env.ARCENPAY_BASE_URL}
/>`;

export default function BillingPage() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [billingData, setBillingData] = useState<DemoRenderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offchainSwitching, setOffchainSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<DemoPlan | null>(null);
  const activationOutcomeRef = useRef<"activated" | "reconciled">(
    "activated",
  );

  const loadBillingState = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        setError(null);

        const configResponse = await fetch("/api/config", {
          cache: "no-store",
        });
        const configPayload = await parseJsonResponse<
          Config & { error?: string }
        >(configResponse, "Billing config endpoint");

        if (!configResponse.ok || !configPayload) {
          throw new Error(
            configPayload?.error ??
              `Failed to load billing config (${configResponse.status})`,
          );
        }

        const nextConfig = configPayload as Config;
        setConfig(nextConfig);

        if (!nextConfig.hasApiKey) {
          setAccessToken(null);
          setBillingData(null);
          setError(
            "ARCENPAY_API_KEY is not set. Add it to .env.local to enable real billing and checkout.",
          );
          return;
        }

        const tokenResponse = await fetch("/api/access-token", {
          method: "POST",
          cache: "no-store",
        });
        const tokenPayload = await parseJsonResponse<AccessTokenResponse>(
          tokenResponse,
          "Access token endpoint",
        );

        if (!tokenResponse.ok || !tokenPayload) {
          throw new Error(
            tokenPayload?.error ??
              `Failed to create an access token (${tokenResponse.status})`,
          );
        }

        if (tokenPayload.error || !tokenPayload.token?.token) {
          throw new Error(
            tokenPayload.error ?? "Failed to create an access token",
          );
        }

        setAccessToken(tokenPayload.token.token);

        if (!nextConfig.componentId) {
          setBillingData(null);
          return;
        }

        const renderResponse = await fetch(
          `${nextConfig.baseUrl}/api/v1/components/${nextConfig.componentId}/render`,
          {
            headers: {
              Authorization: `Bearer ${tokenPayload.token.token}`,
            },
          },
        );

        const renderPayload = (await parseJsonResponse<{
          data?: DemoRenderData;
          error?: string;
        }>(renderResponse, "Billing render endpoint")) as {
          data?: DemoRenderData;
          error?: string;
        } | null;

        if (!renderResponse.ok || !renderPayload?.data) {
          throw new Error(
            renderPayload?.error ?? "Failed to load billing portal data",
          );
        }

        setBillingData(renderPayload.data);
      } catch (err: unknown) {
        setBillingData(null);
        setAccessToken(null);
        setError(
          err instanceof Error ? err.message : "Failed to load billing data",
        );
      } finally {
        if (mode === "initial") {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadBillingState();
  }, [loadBillingState]);

  const plans = billingData?.plans ?? [];
  const invoices = billingData?.recentInvoices ?? [];
  const scheduledTransition = billingData?.subscriptionTransition ?? null;
  const usageItems = useMemo(() => getUsageItems(billingData), [billingData]);

  const handleOffchainPlanSwitch = useCallback(async () => {
    if (!selectedPlan || selectedPlan.onChainPlanId) return;
    if (!accessToken || !config) {
      setError(
        "Missing billing session context. Refresh billing and try again.",
      );
      return;
    }

    try {
      setOffchainSwitching(true);
      setNotice(null);
      setError(null);

      const response = await fetch(`${config.baseUrl}/api/v1/companies/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          planId: selectedPlan.id,
          scheduleAtPeriodEnd: true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        data?: {
          mode?: string;
          scheduled?: boolean;
          planName?: string;
        };
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to switch plan");
      }

      const label = payload.data?.planName ?? selectedPlan.name;
      if (payload.data?.mode === "period_end" || payload.data?.scheduled) {
        setNotice(
          `Plan change to ${label} is scheduled for period end. Your current access remains active until then.`,
        );
      } else {
        setNotice(`Plan switched to ${label}.`);
      }

      setSelectedPlan(null);
      void loadBillingState("refresh");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch plan");
    } finally {
      setOffchainSwitching(false);
    }
  }, [selectedPlan, accessToken, config, loadBillingState]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Billing &amp; Subscriptions</h1>
          <p className={styles.subtitle}>
            Buy the real subscription, then track usage, invoices, billing
            history, and your next bill from the same page.
          </p>
        </div>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={() => void loadBillingState("refresh")}
          disabled={loading || refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh billing"}
        </button>
      </div>

      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.checkoutSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Live checkout</h2>
            <p className={styles.sectionDesc}>
              Paid plans run on-chain checkout. Free plan downgrades use a
              period-end off-chain switch with the same billing surface.
            </p>
          </div>
          <div className={styles.sectionMeta}>
            <code className={styles.code}>
              POST /api/v1/subscriptions/activate
            </code>
          </div>
        </div>

        {loading ? (
          <div className={styles.embedLoading}>
            <div className={styles.spinner} />
            <span>Loading plans and billing state…</span>
          </div>
        ) : error ? (
          <div className={styles.embedError}>
            <div className={styles.errorTitle}>Billing setup needed</div>
            <p className={styles.errorDesc}>{error}</p>
            <Link href="/dashboard/settings" className={styles.btnPrimary}>
              Open Settings
            </Link>
          </div>
        ) : !config?.componentId ? (
          <div className={styles.embedPlaceholder}>
            <div className={styles.placeholderTitle}>
              No billing component configured
            </div>
            <p className={styles.placeholderDesc}>
              Set <code>NEXT_PUBLIC_ARCENPAY_COMPONENT_ID</code> so the demo can
              load plans, usage, invoices, and the customer billing portal.
            </p>
            <div className={styles.placeholderLinks}>
              <a
                href="http://localhost:3000"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.btnPrimary}
              >
                Open Dashboard
              </a>
              <Link href="/dashboard/settings" className={styles.btnSecondary}>
                Configure env
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.planGrid}>
              {plans.map((plan) => {
                const isActive = plan.id === billingData?.activePlan?.id;
                const isFreePlan = Number(plan.price) === 0;
                const isOffchainSelectable = !plan.onChainPlanId && isFreePlan;
                const canCheckout =
                  Boolean(plan.onChainPlanId) || isOffchainSelectable;
                const entitlements = getPlanEntitlements(plan);

                return (
                  <article
                    key={plan.id}
                    className={`${styles.planCard} ${isActive ? styles.planCardActive : ""}`}
                  >
                    <div className={styles.planHeader}>
                      <div>
                        <div className={styles.planTier}>{plan.tier}</div>
                        <h3 className={styles.planName}>{plan.name}</h3>
                      </div>
                      <div
                        className={`${styles.planBadge} ${
                          isActive
                            ? styles.planBadgeActive
                            : canCheckout
                              ? styles.planBadgeLive
                              : styles.planBadgeDisabled
                        }`}
                      >
                        {isActive
                          ? "Current plan"
                          : canCheckout
                            ? isOffchainSelectable
                              ? "Period-end switch"
                              : "Ready to buy"
                            : "On-chain setup missing"}
                      </div>
                    </div>

                    <div className={styles.planPriceRow}>
                      <div className={styles.planPrice}>
                        {formatCurrency(plan.price)}
                      </div>
                      <div className={styles.planInterval}>
                        {formatIntervalLabel(plan.billingInterval)}
                      </div>
                    </div>

                    <p className={styles.planDescription}>
                      {plan.description ?? "Subscription plan"}
                    </p>

                    <div className={styles.planFeatures}>
                      {entitlements.length > 0 ? (
                        entitlements.map((entitlement) => (
                          <div
                            key={`${plan.id}-${entitlement.featureKey}`}
                            className={styles.planFeature}
                          >
                            {describeEntitlement(entitlement)}
                          </div>
                        ))
                      ) : (
                        <div className={styles.planFeatureMuted}>
                          No plan entitlements have been configured yet.
                        </div>
                      )}
                    </div>

                    <div className={styles.planFooter}>
                      <div className={styles.planOnChainId}>
                        {plan.onChainPlanId
                          ? `On-chain plan #${plan.onChainPlanId}`
                          : isOffchainSelectable
                            ? "Free plan is handled off-chain and activates at period end."
                            : "This paid plan cannot be purchased until it is synced on-chain."}
                      </div>
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        onClick={() => {
                          setNotice(null);
                          setSelectedPlan(plan);
                        }}
                        disabled={!canCheckout || isActive}
                      >
                        {isActive
                          ? "Already active"
                          : canCheckout
                            ? isOffchainSelectable
                              ? "Schedule free plan"
                              : "Buy with autopay"
                            : "Unavailable"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className={styles.summaryGrid}>
              <div className={styles.summaryCard}>
                <div className={styles.summaryLabel}>Current plan</div>
                <div className={styles.summaryValue}>
                  {billingData?.activePlan?.name ?? "Free"}
                </div>
                <div className={styles.summaryMeta}>
                  {billingData?.activePlan
                    ? `${formatCurrency(billingData.activePlan.price)} · ${formatIntervalLabel(
                        billingData.activePlan.billingInterval,
                      )}`
                    : "No paid subscription active"}
                </div>
                {scheduledTransition ? (
                  <div className={styles.summaryTransition}>
                    Scheduled: {scheduledTransition.targetPlanName ?? "Free"} at
                    period end
                  </div>
                ) : null}
              </div>

              <div className={styles.summaryCard}>
                <div className={styles.summaryLabel}>Next bill</div>
                <div className={styles.summaryValue}>
                  {formatDateLabel(billingData?.nextBillingAt)}
                </div>
                <div className={styles.summaryMeta}>
                  {billingData?.nextBillingAt
                    ? "Pulled from the on-chain subscription expiry"
                    : "Shows after a paid subscription is active"}
                </div>
                {scheduledTransition ? (
                  <div className={styles.summaryTransition}>
                    {formatDateLabel(
                      scheduledTransition.effectiveAt ??
                        billingData?.nextBillingAt,
                    )}
                  </div>
                ) : null}
              </div>

              <div className={styles.summaryCard}>
                <div className={styles.summaryLabel}>Payment account</div>
                <div className={styles.summaryValue}>
                  {truncateWallet(
                    billingData?.paymentMethod?.walletAddress ?? null,
                  )}
                </div>
                <div className={styles.summaryMeta}>
                  {billingData?.paymentMethod?.token ?? "USDC"} ·{" "}
                  {billingData?.paymentMethod?.chainId ?? "testnet"}
                </div>
              </div>

              <div className={styles.summaryCard}>
                <div className={styles.summaryLabel}>Invoices issued</div>
                <div className={styles.summaryValue}>{invoices.length}</div>
                <div className={styles.summaryMeta}>
                  Billing history and PDF downloads stay in sync here.
                </div>
              </div>
            </div>

            <div className={styles.twoColumn}>
              <section className={styles.dataPanel}>
                <div className={styles.panelHeader}>
                  <h3 className={styles.panelTitle}>Usage &amp; limits</h3>
                  <p className={styles.panelDesc}>
                    Numerical entitlements render as real progress meters like
                    <code> 0 / 200 </code> instead of simulated placeholders.
                  </p>
                </div>

                {usageItems.length > 0 ? (
                  <div className={styles.usageList}>
                    {usageItems.map((item) => {
                      const pct =
                        typeof item.limit === "number" && item.limit > 0
                          ? Math.min((item.used / item.limit) * 100, 100)
                          : 0;

                      return (
                        <div key={item.featureKey} className={styles.usageCard}>
                          <div className={styles.usageTop}>
                            <div>
                              <div className={styles.usageName}>
                                {item.name}
                              </div>
                              <div className={styles.usageMeta}>
                                {formatUsageLabel(item)}
                              </div>
                            </div>
                            <div className={styles.usagePercent}>
                              {Math.round(pct)}%
                            </div>
                          </div>
                          {typeof item.limit === "number" ? (
                            <div className={styles.progressTrack}>
                              <div
                                className={styles.progressFill}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    No metered usage has been configured for the active plan
                    yet.
                  </div>
                )}
              </section>

              <section className={styles.dataPanel}>
                <div className={styles.panelHeader}>
                  <h3 className={styles.panelTitle}>
                    Invoices &amp; billing history
                  </h3>
                  <p className={styles.panelDesc}>
                    Each successful charge should appear here with status,
                    amount, and a PDF download link.
                  </p>
                </div>

                {invoices.length > 0 ? (
                  <div className={styles.invoiceList}>
                    {invoices.map((invoice) => (
                      <div key={invoice.id} className={styles.invoiceRow}>
                        <div>
                          <div className={styles.invoiceNumber}>
                            {invoice.number ?? invoice.id}
                          </div>
                          <div className={styles.invoiceMeta}>
                            {invoice.status} ·{" "}
                            {formatDateLabel(
                              invoice.paidAt ??
                                invoice.dueAt ??
                                invoice.issuedAt,
                            )}
                          </div>
                        </div>
                        <div className={styles.invoiceRight}>
                          <div className={styles.invoiceAmount}>
                            {formatCurrency(invoice.total, invoice.currency)}
                          </div>
                          {invoice.downloadUrl ? (
                            <a
                              href={invoice.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.invoiceLink}
                            >
                              Download PDF
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    No invoices yet. After the first successful activation
                    charge, billing history will appear here.
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>

      <div className={styles.embedSection}>
        <div className={styles.embedHeader}>
          <div>
            <h2 className={styles.embedTitle}>Customer billing portal</h2>
            <p className={styles.sectionDesc}>
              The embed below renders the full billing component with all
              configured sections, including plan management, usage, invoices,
              and cancellation controls.
            </p>
          </div>
          <div className={styles.embedMeta}>
            <code className={styles.code}>&lt;ArcenEmbed /&gt;</code>
            {config?.componentId ? (
              <span className={styles.compId}>
                id: {config.componentId.slice(0, 14)}…
              </span>
            ) : (
              <span className={styles.compIdMissing}>component ID not set</span>
            )}
          </div>
        </div>

        <div className={styles.embedContainer}>
          {billingData && accessToken && config?.componentId ? (
            <ArcenEmbed
              accessToken={accessToken}
              componentId={config.componentId}
              baseUrl={config.baseUrl}
              className={styles.embed}
            />
          ) : (
            <div className={styles.embedLoading}>
              <span>
                Billing portal will appear after configuration finishes.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.howSection}>
        <h2 className={styles.sectionTitle}>How this demo is wired</h2>
        <div className={styles.steps}>
          <div className={styles.step}>
            <div className={styles.stepNum}>1</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>
                Issue an embed access token
              </div>
              <p className={styles.stepDesc}>
                The demo identifies a stable company/user pair and mints a
                short-lived access token from the backend.
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>2</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>
                Load the published billing component
              </div>
              <p className={styles.stepDesc}>
                The page fetches the real component render payload so it can
                show plans, current entitlements, invoice history, and next
                billing.
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>3</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Open wallet checkout</div>
              <p className={styles.stepDesc}>
                Paid plans run wallet checkout. Free plan changes open a
                period-end confirmation flow from the same pricing card.
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <div className={styles.stepNum}>4</div>
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>Refresh billing state</div>
              <p className={styles.stepDesc}>
                After activation, the page reloads and immediately shows the
                active plan, usage meters, invoices, billing history, and next
                bill.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.codeBlock}>
          <div className={styles.codeTitle}>
            Full integration — app/dashboard/billing/page.tsx
          </div>
          <pre className={styles.codePre}>
            <code>{INTEGRATION_CODE}</code>
          </pre>
        </div>
      </div>

      {selectedPlan?.onChainPlanId ? (
        <CheckoutModal
          isOpen
          planId={BigInt(selectedPlan.onChainPlanId)}
          onClose={() => setSelectedPlan(null)}
          requestSubscription={async ({
            planId,
            paymentAccount,
            subscriberEmail,
          }) => {
            const response = await fetch("/api/request-subscription", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                planId: planId.toString(),
                paymentAccount,
                subscriberEmail,
              }),
            });

            const result = (await response.json().catch(() => ({}))) as {
              tokenId?: string | number;
              txHash?: `0x${string}`;
              error?: string;
              alreadyActive?: boolean;
              reconciled?: boolean;
            };

            if (!response.ok) {
              throw new Error(result.error ?? "Activation failed");
            }

            if (result.alreadyActive) {
              activationOutcomeRef.current = "reconciled";
            } else {
              activationOutcomeRef.current = "activated";
            }

            return result;
          }}
          onSuccess={(tokenId) => {
            setSelectedPlan(null);
            setNotice(
              activationOutcomeRef.current === "reconciled"
                ? `This subscription was already active on-chain. Token #${tokenId.toString()} has been reconciled and the billing state is now refreshed.`
                : `Subscription activated successfully. Token #${tokenId.toString()} is now active.`,
            );
            void loadBillingState("refresh");
          }}
          onError={(checkoutError) => {
            setNotice(null);
            setError(checkoutError.message);
          }}
        />
      ) : selectedPlan ? (
        <div
          className={styles.dialogBackdrop}
          onClick={() => {
            if (!offchainSwitching) {
              setSelectedPlan(null);
            }
          }}
        >
          <div
            className={styles.dialogCard}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className={styles.dialogTitle}>Schedule downgrade</h3>
            <p className={styles.dialogBody}>
              Switch to <strong>{selectedPlan.name}</strong> at period end. Your
              current plan remains active until the billing cycle closes.
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={offchainSwitching}
                onClick={() => setSelectedPlan(null)}
              >
                Keep current plan
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={offchainSwitching}
                onClick={() => void handleOffchainPlanSwitch()}
              >
                {offchainSwitching ? "Scheduling…" : "Schedule change"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
