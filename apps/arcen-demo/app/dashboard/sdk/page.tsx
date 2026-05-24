"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArcenEmbed,
  FeatureFlagGuard,
  TemplateRenderer,
  createPaymentLinkCheckoutUrl,
  getDesignTokens,
  renderElement,
  useArcenPay,
  useConsumeEntitlement,
  useEntitlement,
  useFlag,
  useFlags,
  useTrack,
} from "@arcenpay/react";
import type {
  ComponentDesign,
  ComponentElement,
  ComponentRenderData,
  TemplateBlock,
} from "@arcenpay/react";
import { useWallet } from "../useWallet";
import styles from "./page.module.css";

type NodeShowcaseResponse = {
  ok: boolean;
  status: {
    hasApiKey: boolean;
    componentId: string;
    company: { id?: string; wallet?: string; name?: string };
    user: { id?: string; wallet?: string; name?: string; email?: string };
  };
  snapshot?: {
    identify: {
      companyId: string;
      userId?: string;
      expiresAt: string;
    };
    accessToken: {
      token: string;
      expiresAt: string;
    };
    flag: Record<string, unknown>;
    entitlement: Record<string, unknown>;
    flags: Record<string, unknown>;
    companies: Record<string, unknown>;
    companyDetails: Record<string, unknown> | null;
    webhook: {
      sampleSecret: string;
      signature: string;
      verified: boolean;
    };
    protocolEvent: {
      idempotencyKey: string;
      billingType: string;
      event: Record<string, unknown>;
    };
  };
  error?: string;
};

type NodeActionResponse = {
  ok: boolean;
  action?: string | null;
  result?: unknown;
  error?: string;
};

const REACT_RUNTIME_SURFACE = [
  {
    name: "ArcenPayProvider + useArcenPay",
    kind: "provider",
    useCase: "Bootstraps wallet, network, session identification, and component context.",
  },
  {
    name: "ArcenEmbed / ArcenpayEmbed",
    kind: "managed UI",
    useCase: "ArcenPay-managed billing portal for plans, payment methods, and subscription actions.",
  },
  {
    name: "FeatureFlagGuard",
    kind: "gating UI",
    useCase: "Conditionally reveals premium experiences behind entitlements.",
  },
  {
    name: "TemplateRenderer",
    kind: "rendering",
    useCase: "Renders simple billing templates from JSON blocks.",
  },
  {
    name: "useFlag / useFlags",
    kind: "hooks",
    useCase: "Reads dashboard-managed feature flags in React.",
  },
  {
    name: "useEntitlement",
    kind: "hooks",
    useCase: "Combines on-chain subscription state with entitlement resolution.",
  },
  {
    name: "useConsumeEntitlement",
    kind: "hooks",
    useCase: "Consumes metered access from the browser using the Arcen session token.",
  },
  {
    name: "useTrack",
    kind: "hooks",
    useCase: "Sends product and usage events to ArcenPay.",
  },
  {
    name: "createPaymentLinkCheckoutUrl",
    kind: "utility",
    useCase: "Builds shareable payment-link URLs.",
  },
  {
    name: "renderElement + getDesignTokens",
    kind: "builder utility",
    useCase: "Powers custom portal builders and preview tooling.",
  },
];

const NODE_SERVICE_MATRIX = [
  { name: "ArcenClient", tag: "live", useCase: "Server-side API client for companies, flags, entitlements, tracking, and access tokens." },
  { name: "x402Middleware", tag: "api gateway", useCase: "Protect paid endpoints with HTTP 402 and on-chain payment validation." },
  { name: "verifyWebhookSignature", tag: "live", useCase: "Verify signed ArcenPay webhook requests using the SDK helper." },
  { name: "buildEventIdempotencyKey", tag: "live", useCase: "Build stable ids for billing and protocol events." },
  { name: "createProtocolEvent", tag: "live", useCase: "Create canonical protocol event payloads for downstream systems." },
  { name: "mapProtocolEventToBillingType", tag: "live", useCase: "Bridge protocol events into billing-event categories." },
  { name: "InMemoryNonceStore / RedisNonceStore", tag: "infra", useCase: "Prevent replay in x402 flows." },
  { name: "ArcenApiError", tag: "error model", useCase: "Typed SDK error surface for public Node integrations." },
];

const TEMPLATE_BLOCKS: TemplateBlock[] = [
  { type: "heading", content: "Growth plan" },
  { type: "text", content: "Good for teams that want usage metering, embeds, and policy checks in one place." },
  { type: "price", amount: "$29", interval: "/month" },
  { type: "feature-list", items: ["ArcenEmbed billing portal", "3 live feature flags", "Metered scan entitlement"] },
  { type: "cta", content: "Open billing workspace", href: "/dashboard/billing" },
];

export default function SdkShowcasePage() {
  const { address, shortAddr } = useWallet();
  const arcen = useArcenPay();
  const { identify, session } = arcen;
  const identifiedWalletRef = useRef<string | null>(null);
  const [identifyState, setIdentifyState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [identifyError, setIdentifyError] = useState<string | null>(null);
  const [eventStatus, setEventStatus] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [nodeState, setNodeState] = useState<NodeShowcaseResponse | null>(null);
  const [nodeLoading, setNodeLoading] = useState(true);
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [nodeActionResult, setNodeActionResult] = useState<NodeActionResponse | null>(null);
  const [nodeActionBusy, setNodeActionBusy] = useState<string | null>(null);
  const normalizedAddress = address?.toLowerCase() ?? null;
  const identified =
    !!normalizedAddress &&
    !!session.token &&
    session.company?.wallet?.toLowerCase() === normalizedAddress;
  const identifyingWalletRef = useRef<string | null>(null);

  const scanFlag = useFlag(identified ? "scan" : "");
  const flagMap = useFlags(
    identified ? ["scan", "api-access", "export-pdf"] : [],
  );
  const entitlement = useEntitlement(
    identified ? (address ?? undefined) : undefined,
    "scan",
  );
  const { consume, loading: consumeLoading } = useConsumeEntitlement();
  const { track } = useTrack();

  useEffect(() => {
    if (!address) {
      identifiedWalletRef.current = null;
      setIdentifyState("idle");
      setIdentifyError(null);
      return;
    }

    if (
      session.token &&
      session.company?.wallet?.toLowerCase() === normalizedAddress
    ) {
      identifiedWalletRef.current = normalizedAddress;
      identifyingWalletRef.current = null;
      setIdentifyState("ready");
      setIdentifyError(null);
      return;
    }

    if (
      identifiedWalletRef.current === normalizedAddress ||
      identifyingWalletRef.current === normalizedAddress
    ) {
      return;
    }

    let cancelled = false;
    identifyingWalletRef.current = normalizedAddress;
    setIdentifyState("loading");
    setIdentifyError(null);

    void identify({
        company: {
          id: `company-${address.slice(2, 10)}`,
          wallet: address,
        },
        user: {
          id: `user-${address.slice(2, 10)}`,
          wallet: address,
        },
      })
      .then(() => {
        if (cancelled) return;
        identifiedWalletRef.current = normalizedAddress;
        identifyingWalletRef.current = null;
        setIdentifyState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        identifyingWalletRef.current = null;
        setIdentifyState("error");
        setIdentifyError(
          error instanceof Error ? error.message : "Failed to identify demo company",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [address, identify, normalizedAddress, session.company?.wallet, session.token]);

  useEffect(() => {
    let cancelled = false;

    async function loadNodeState() {
      setNodeLoading(true);
      setNodeError(null);
      try {
        const response = await fetch("/api/sdk/node-showcase", {
          cache: "no-store",
        });
        const data = (await response.json()) as NodeShowcaseResponse;
        if (cancelled) return;
        if (!response.ok || !data.ok) {
          throw new Error(data.error ?? "Failed to load Node showcase");
        }
        setNodeState(data);
      } catch (error) {
        if (cancelled) return;
        setNodeError(
          error instanceof Error ? error.message : "Failed to load Node showcase",
        );
      } finally {
        if (!cancelled) setNodeLoading(false);
      }
    }

    void loadNodeState();
    return () => {
      cancelled = true;
    };
  }, []);

  const paymentLinkUrl = useMemo(
    () => createPaymentLinkCheckoutUrl("sdk-demo-growth"),
    [],
  );

  const builderDesign = useMemo<ComponentDesign>(
    () => ({
      primaryColor: "#7df9d0",
      secondaryColor: "#0f172a",
      fontFamily: "'DM Sans', sans-serif",
      fontSize: 14,
      fontColor: "#e7f7f3",
      backgroundColor: "#06121a",
      borderRadius: 16,
      cardStyle: "elevated",
      columns: 1,
      sections: "separate",
    }),
    [],
  );

  const builderTokens = useMemo(() => getDesignTokens(builderDesign), [builderDesign]);

  const builderData = useMemo<ComponentRenderData>(
    () => ({
      component: {
        id: "sdk-showcase-preview",
        name: "SDK Showcase Preview",
        elements: [],
        design: builderDesign,
      },
      company: {
        id: arcen.session.company?.id ?? "sdk-demo-company",
        name: arcen.session.company?.name ?? "SDK Demo Company",
        walletAddress:
          arcen.session.company?.wallet ??
          address ??
          "0x0000000000000000000000000000000000000001",
      },
      activePlan: {
        id: "growth",
        name: "Growth",
        tier: "pro",
        price: "29.00",
        billingInterval: 2592000,
        description: "Usage-aware billing with embeds and policy controls.",
      },
      plans: [
        {
          id: "free",
          name: "Free",
          tier: "free",
          price: "0",
          billingInterval: 2592000,
          description: "Starter sandbox",
        },
        {
          id: "growth",
          name: "Growth",
          tier: "pro",
          price: "29.00",
          billingInterval: 2592000,
          description: "Best fit for SaaS integrations",
        },
      ],
      entitlements: [
        {
          featureKey: "scan",
          name: "Scan",
          value: true,
          featureType: "credit",
        },
      ],
      usage: [],
    }),
    [address, arcen.session.company],
  );

  const builderPreview = useMemo(() => {
    const elements = [
      {
        type: "text",
        heading: "Builder primitives",
        body: "renderElement() and getDesignTokens() let you create previews and custom portal surfaces outside the main embed.",
        alignment: "left",
      },
      {
        type: "button",
        label: "Open payment link demo",
        href: paymentLinkUrl,
        variant: "primary",
      },
    ] as Array<ComponentElement & Record<string, unknown>>;

    return elements.map((element, index) =>
      renderElement(
        element,
        index,
        builderData,
        builderTokens,
        () => undefined,
        () => undefined,
        () => undefined,
        false,
        false,
      ),
    );
  }, [builderData, builderTokens, paymentLinkUrl]);

  async function handleTrackDemo() {
    setEventStatus(null);
    setEventError(null);
    try {
      await track("sdk_showcase_frontend_track", {
        surface: "react-sdk",
        wallet: address ?? "guest",
      });
      setEventStatus("Tracked `sdk_showcase_frontend_track` through useTrack().");
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "Track failed");
    }
  }

  async function handleConsumeDemo() {
    setEventStatus(null);
    setEventError(null);
    try {
      const result = await consume("scan");
      if (!result.consumed) {
        setEventError(result.reason ?? "Entitlement was not consumed");
        return;
      }
      setEventStatus(
        `Consumed scan entitlement via useConsumeEntitlement(). Usage is now ${result.usage}.`,
      );
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "Consume failed");
    }
  }

  async function runNodeAction(action: string) {
    setNodeActionBusy(action);
    setNodeActionResult(null);
    setNodeError(null);
    try {
      const response = await fetch("/api/sdk/node-showcase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as NodeActionResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? `Action ${action} failed`);
      }
      setNodeActionResult(data);

      const refresh = await fetch("/api/sdk/node-showcase", { cache: "no-store" });
      const refreshed = (await refresh.json()) as NodeShowcaseResponse;
      if (refresh.ok && refreshed.ok) {
        setNodeState(refreshed);
      }
    } catch (error) {
      setNodeError(error instanceof Error ? error.message : "Node action failed");
    } finally {
      setNodeActionBusy(null);
    }
  }

  return (
    <div className={styles.root}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>ArcenPay Demo Studio</div>
          <h1 className={styles.title}>One workspace that shows the full React and Node SDK story.</h1>
          <p className={styles.subtitle}>
            This page is a live catalog of the public SDK surface: managed billing UI,
            React hooks, builder helpers, Node client methods, webhook verification,
            protocol events, and the backend services your production integration can grow into.
          </p>
          <div className={styles.heroActions}>
            <Link href="/dashboard/billing" className={styles.btnPrimary}>
              Open Billing Portal
            </Link>
            <a href={paymentLinkUrl} className={styles.btnSecondary} target="_blank" rel="noreferrer">
              Test Payment Link
            </a>
          </div>
        </div>

        <div className={styles.heroPanel}>
          <Metric label="Wallet" value={shortAddr ?? "Not connected"} tone={address ? "good" : "muted"} />
          <Metric
            label="React session"
            value={
              identifyState === "ready"
                ? "identified"
                : identifyState === "loading"
                  ? "identifying"
                  : identifyState
            }
            tone={identifyState === "ready" ? "good" : identifyState === "error" ? "danger" : "muted"}
          />
          <Metric
            label="Node API"
            value={nodeState?.status.hasApiKey ? "configured" : "missing key"}
            tone={nodeState?.status.hasApiKey ? "good" : "danger"}
          />
          <Metric
            label="Embed component"
            value={arcen.componentId || nodeState?.status.componentId || "not configured"}
            tone={arcen.componentId || nodeState?.status.componentId ? "good" : "warning"}
          />
        </div>
      </section>

      {identifyError ? <Banner tone="danger">{identifyError}</Banner> : null}
      {nodeError ? <Banner tone="danger">{nodeError}</Banner> : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <div className={styles.sectionEyebrow}>React SDK</div>
            <h2 className={styles.sectionTitle}>Live frontend surface</h2>
            <p className={styles.sectionDesc}>
              Everything here is powered by the public `@arcenpay/react` exports that app developers are expected to use.
            </p>
          </div>
          <div className={styles.badgeRow}>
            <span className={styles.badge}>Provider</span>
            <span className={styles.badge}>Hooks</span>
            <span className={styles.badge}>Managed UI</span>
            <span className={styles.badge}>Builder helpers</span>
          </div>
        </div>

        <div className={styles.surfaceGrid}>
          {REACT_RUNTIME_SURFACE.map((item) => (
            <article key={item.name} className={styles.surfaceCard}>
              <div className={styles.surfaceKind}>{item.kind}</div>
              <h3 className={styles.surfaceTitle}>{item.name}</h3>
              <p className={styles.surfaceDesc}>{item.useCase}</p>
            </article>
          ))}
        </div>

        <div className={styles.demoGrid}>
          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardEyebrow}>Session demo</div>
                <h3 className={styles.cardTitle}>`ArcenPayProvider` + `useArcenPay`</h3>
              </div>
              <span className={styles.cardStatus}>
                {identifyState === "ready" ? "Ready" : identifyState === "loading" ? "Loading" : "Waiting"}
              </span>
            </div>
            <dl className={styles.keyValue}>
              <div>
                <dt>Company</dt>
                <dd>{arcen.session.company?.id ?? "No company identified yet"}</dd>
              </div>
              <div>
                <dt>Wallet</dt>
                <dd>{arcen.session.company?.wallet ?? address ?? "Connect a wallet"}</dd>
              </div>
              <div>
                <dt>Token</dt>
                <dd>{arcen.session.token ? `${arcen.session.token.slice(0, 18)}…` : "No token yet"}</dd>
              </div>
              <div>
                <dt>Chain</dt>
                <dd>{arcen.network.name} ({arcen.network.chainId})</dd>
              </div>
            </dl>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardEyebrow}>Hooks demo</div>
                <h3 className={styles.cardTitle}>Flags, entitlements, tracking, and metering</h3>
              </div>
            </div>
            <div className={styles.metricGrid}>
              <Metric label="useFlag('scan')" value={scanFlag ? "enabled" : "disabled"} tone={scanFlag ? "good" : "danger"} />
              <Metric
                label="useFlags('api-access')"
                value={flagMap["api-access"] ? "enabled" : "disabled"}
                tone={flagMap["api-access"] ? "good" : "danger"}
              />
              <Metric
                label="Plan tier"
                value={entitlement.planTier ?? "unknown"}
                tone={entitlement.planTier ? "good" : "muted"}
              />
              <Metric
                label="Entitlement usage"
                value={
                  entitlement.features.scan !== undefined
                    ? String(entitlement.features.scan)
                    : entitlement.isLoading
                      ? "loading"
                      : "n/a"
                }
                tone="muted"
              />
            </div>
            <div className={styles.actionRow}>
              <button className={styles.btnPrimary} onClick={handleTrackDemo}>
                Trigger useTrack()
              </button>
              <button
                className={styles.btnSecondary}
                onClick={handleConsumeDemo}
                disabled={consumeLoading || !arcen.session.token}
              >
                {consumeLoading ? "Consuming…" : "Consume scan entitlement"}
              </button>
            </div>
            {eventStatus ? <Banner tone="success">{eventStatus}</Banner> : null}
            {eventError ? <Banner tone="danger">{eventError}</Banner> : null}
          </article>

          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardEyebrow}>Managed UI</div>
                <h3 className={styles.cardTitle}>`ArcenEmbed` live preview</h3>
              </div>
              <Link href="/dashboard/billing" className={styles.inlineLink}>
                open full page
              </Link>
            </div>
            <div className={styles.embedShell}>
              {arcen.componentId && arcen.session.token ? (
                <ArcenEmbed className={styles.embed} mode="inline" />
              ) : (
                <div className={styles.embedPlaceholder}>
                  <strong>Embed preview is waiting for setup.</strong>
                  <span>
                    Connect a wallet, let the provider identify the demo company, and set `NEXT_PUBLIC_ARCENPAY_COMPONENT_ID`.
                  </span>
                </div>
              )}
            </div>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardEyebrow}>Gating UI</div>
                <h3 className={styles.cardTitle}>`FeatureFlagGuard` + `TemplateRenderer`</h3>
              </div>
            </div>
            <div className={styles.guardShell}>
              {address ? (
                <FeatureFlagGuard
                  featureKey="scan"
                  walletAddress={address}
                  fallback={
                    <div className={styles.guardFallback}>
                      The scan entitlement is currently unavailable for this wallet.
                    </div>
                  }
                >
                  <div className={styles.guardContent}>
                    <span className={styles.guardPill}>Premium content unlocked</span>
                    <p>
                      This block is wrapped by `FeatureFlagGuard`, so it only renders when the entitlement passes.
                    </p>
                  </div>
                </FeatureFlagGuard>
              ) : (
                <div className={styles.guardFallback}>Connect a wallet to exercise the guard.</div>
              )}
            </div>
            <div className={styles.templateShell}>
              <TemplateRenderer name="growth-plan" blocks={TEMPLATE_BLOCKS} />
            </div>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardEyebrow}>Utilities</div>
                <h3 className={styles.cardTitle}>Payment links and builder helpers</h3>
              </div>
            </div>
            <div className={styles.codePanel}>
              <div>
                <span className={styles.codeLabel}>createPaymentLinkCheckoutUrl()</span>
                <a href={paymentLinkUrl} target="_blank" rel="noreferrer" className={styles.codeValue}>
                  {paymentLinkUrl}
                </a>
              </div>
              <div>
                <span className={styles.codeLabel}>getDesignTokens()</span>
                <pre className={styles.json}>{JSON.stringify(builderTokens, null, 2)}</pre>
              </div>
            </div>
            <div className={styles.builderPreview}>{builderPreview}</div>
          </article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <div className={styles.sectionEyebrow}>Node SDK</div>
            <h2 className={styles.sectionTitle}>Backend console and service map</h2>
            <p className={styles.sectionDesc}>
              The cards below are driven by a real Next.js backend route that imports `@arcenpay/node` and executes the public client/helper APIs.
            </p>
          </div>
          <div className={styles.badgeRow}>
            <span className={styles.badge}>Live client calls</span>
            <span className={styles.badge}>Webhook helper</span>
            <span className={styles.badge}>Protocol events</span>
          </div>
        </div>

        <div className={styles.demoGrid}>
          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardEyebrow}>Live snapshot</div>
                <h3 className={styles.cardTitle}>Current backend state</h3>
              </div>
              <button className={styles.btnSecondary} onClick={() => void runNodeAction("listCompanies")} disabled={nodeActionBusy !== null}>
                Inspect companies
              </button>
            </div>
            {nodeLoading ? (
              <div className={styles.placeholder}>Loading Node showcase…</div>
            ) : nodeState?.snapshot ? (
              <div className={styles.snapshotGrid}>
                <Metric label="identify()" value={nodeState.snapshot.identify.companyId} tone="good" />
                <Metric label="createAccessToken()" value={nodeState.snapshot.accessToken.expiresAt.slice(0, 10)} tone="muted" />
                <Metric
                  label="checkFlag('api-access')"
                  value={String((nodeState.snapshot.flag as { enabled?: boolean }).enabled ?? "error")}
                  tone={(nodeState.snapshot.flag as { enabled?: boolean }).enabled ? "good" : "warning"}
                />
                <Metric
                  label="checkEntitlement('scan')"
                  value={String((nodeState.snapshot.entitlement as { enabled?: boolean }).enabled ?? "error")}
                  tone={(nodeState.snapshot.entitlement as { enabled?: boolean }).enabled ? "good" : "warning"}
                />
              </div>
            ) : (
              <div className={styles.placeholder}>No snapshot available.</div>
            )}
          </article>

          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardEyebrow}>Client methods</div>
                <h3 className={styles.cardTitle}>Run public `ArcenClient` actions</h3>
              </div>
            </div>
            <div className={styles.actionGrid}>
              {[
                ["identify", "identify()"],
                ["createAccessToken", "createAccessToken()"],
                ["checkFlags", "checkFlags()"],
                ["track", "track()"],
                ["consume", "consumeEntitlement()"],
                ["listCompanies", "listCompanies()"],
              ].map(([action, label]) => (
                <button
                  key={action}
                  className={styles.actionButton}
                  onClick={() => void runNodeAction(action)}
                  disabled={nodeActionBusy !== null}
                >
                  {nodeActionBusy === action ? "Running…" : label}
                </button>
              ))}
            </div>
            <pre className={styles.json}>
              {JSON.stringify(nodeActionResult ?? nodeState?.snapshot?.flags ?? { note: "Run an action to inspect output." }, null, 2)}
            </pre>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardEyebrow}>Helpers</div>
                <h3 className={styles.cardTitle}>Webhook verification and protocol events</h3>
              </div>
            </div>
            <div className={styles.helperGrid}>
              <div className={styles.helperCard}>
                <div className={styles.helperTitle}>verifyWebhookSignature()</div>
                <p className={styles.helperText}>
                  The demo webhook endpoint now verifies signatures with the SDK helper instead of custom crypto code.
                </p>
                <div className={styles.helperStatus}>
                  Sample verification: {nodeState?.snapshot?.webhook.verified ? "valid" : "invalid"}
                </div>
              </div>
              <div className={styles.helperCard}>
                <div className={styles.helperTitle}>Protocol event helpers</div>
                <p className={styles.helperText}>
                  Build idempotent event envelopes for renewals, invoices, proofs, and billing bridges.
                </p>
                <div className={styles.helperStatus}>
                  Billing type: {nodeState?.snapshot?.protocolEvent.billingType ?? "—"}
                </div>
              </div>
            </div>
            <pre className={styles.json}>
              {JSON.stringify(nodeState?.snapshot?.protocolEvent.event ?? { note: "Protocol event snapshot unavailable." }, null, 2)}
            </pre>
          </article>
        </div>

        <div className={styles.serviceGrid}>
          {NODE_SERVICE_MATRIX.map((service) => (
            <article key={service.name} className={styles.serviceCard}>
              <div className={styles.serviceTag} data-tag={service.tag}>
                {service.tag}
              </div>
              <h3 className={styles.serviceTitle}>{service.name}</h3>
              <p className={styles.serviceDesc}>{service.useCase}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warning" | "danger" | "muted";
}) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricValue} data-tone={tone}>
        {value}
      </div>
    </div>
  );
}

function Banner({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "success" | "danger";
}) {
  return (
    <div className={styles.banner} data-tone={tone}>
      {children}
    </div>
  );
}
