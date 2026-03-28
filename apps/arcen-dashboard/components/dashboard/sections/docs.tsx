"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Layers,
  Users,
  Cpu,
  Flag,
  Code2,
  FileCode2,
  ChevronRight,
  Copy,
  Check,
  Zap,
  ShieldCheck,
  ArrowRight,
  CircleDot,
  Terminal,
  ExternalLink,
} from "lucide-react";

// ── Doc sections ─────────────────────────────────────────────────────────────

type DocSection =
  | "overview"
  | "plans"
  | "subscriptions"
  | "sessions"
  | "features"
  | "sdk"
  | "contracts";

const DOC_GROUPS = [
  {
    title: "Getting Started",
    items: [{ id: "overview", label: "Overview", icon: BookOpen }],
  },
  {
    title: "Core Concepts",
    items: [
      { id: "plans", label: "Plans", icon: Layers },
      { id: "subscriptions", label: "Subscriptions", icon: Users },
      { id: "sessions", label: "Sessions & Gas", icon: Cpu },
      { id: "features", label: "Feature Flags", icon: Flag },
    ],
  },
  {
    title: "Developers",
    items: [
      { id: "sdk", label: "SDK Reference", icon: Code2 },
      { id: "contracts", label: "Contract Addresses", icon: FileCode2 },
    ],
  },
] as const;

const TOC: Record<DocSection, { id: string; label: string }[]> = {
  overview: [
    { id: "overview", label: "Overview" },
    { id: "end-to-end-flow", label: "End-to-end flow" },
  ],
  plans: [
    { id: "plans", label: "Plans" },
    { id: "creating-a-plan", label: "Creating a plan" },
    { id: "contract-call-signature", label: "Contract call signature" },
    { id: "plan-lifecycle", label: "Plan lifecycle" },
  ],
  subscriptions: [
    { id: "subscriptions", label: "Subscriptions" },
    { id: "subscription-lifecycle", label: "Subscription lifecycle" },
    { id: "querying-subscribers", label: "Querying subscribers (subgraph)" },
    { id: "on-chain-check", label: "On-chain subscriber check" },
  ],
  sessions: [
    { id: "sessions", label: "Sessions & Gas Sponsorship" },
    { id: "how-gas-sponsorship-works", label: "How gas sponsorship works" },
    { id: "vault-interface", label: "Vault contract interface" },
    { id: "gas-budget-tiers", label: "Gas budget tiers" },
  ],
  features: [
    { id: "features", label: "Feature Flags" },
    { id: "flag-schema", label: "Flag schema" },
    { id: "reading-flags", label: "Reading flags in your app" },
    { id: "meap-react-hook", label: "@arcenpay/react hook" },
  ],
  sdk: [
    { id: "sdk", label: "SDK Overview" },
    { id: "installation", label: "Installation" },
    { id: "core-exports", label: "@arcenpay/sdk" },
    { id: "react-components", label: "React Components" },
    { id: "react-hooks", label: "React Hooks" },
    { id: "node-sdk", label: "@arcenpay/node" },
    { id: "quick-start", label: "Quick Start" },
  ],
  contracts: [
    { id: "contracts", label: "Contract Addresses" },
    { id: "sepolia", label: "Sepolia (testnet)" },
    { id: "base-sepolia", label: "Base Sepolia (testnet)" },
    { id: "base-mainnet", label: "Base (mainnet)" },
    { id: "block-explorers", label: "Block explorers" },
  ],
};

// ── Small primitives ──────────────────────────────────────────────────────────

function SectionHeading({
  title,
  breadcrumb,
}: {
  title: string;
  breadcrumb?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="mb-6 pt-2"
      id={title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
    >
      {breadcrumb && (
        <p className="text-accent text-sm font-medium mb-2">{breadcrumb}</p>
      )}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-8 gap-1.5 hidden sm:flex bg-card/50 backdrop-blur-sm shadow-sm"
          onClick={() => {
            navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          Copy page
        </Button>
      </div>
    </div>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-base text-muted-foreground mb-8 leading-relaxed max-w-2xl">
      {children}
    </p>
  );
}

function H3({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="text-xl font-semibold text-foreground mt-10 mb-5 tracking-tight scroll-m-20 pb-2 border-b border-border/40"
    >
      {children}
    </h2>
  );
}

function CodeBlock({ code, lang = "ts" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-xl border border-border/70 bg-[#0A0A0B] overflow-hidden mb-6 shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-[#121214]">
        <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider font-semibold">
          {lang}
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <Check className="w-4 h-4 text-accent" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>
      <pre className="p-4 text-[13px] font-mono text-gray-300 overflow-x-auto leading-relaxed whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

function StepCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 mb-6">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/15 border border-accent/20 flex items-center justify-center mt-0.5 shadow-sm">
        <span className="text-xs font-bold text-accent">{step}</span>
      </div>
      <div className="flex-1">
        <p className="text-base font-semibold text-foreground mb-1.5">
          {title}
        </p>
        <div className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
          {children}
        </div>
      </div>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-4 rounded-xl bg-accent/5 border border-accent/20 mb-6 shadow-sm">
      <Zap className="w-5 h-5 text-accent shrink-0 mt-0.5" />
      <p className="text-sm text-foreground/80 leading-relaxed font-medium">
        {children}
      </p>
    </div>
  );
}

function PropTable({
  rows,
}: {
  rows: { name: string; type: string; description: string }[];
}) {
  return (
    <div className="rounded-xl border border-border/70 overflow-hidden mb-8 shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary/40 border-b border-border/70">
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">
              Name
            </th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">
              Type
            </th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">
              Description
            </th>
          </tr>
        </thead>
        <tbody className="bg-card/30">
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors"
            >
              <td className="px-4 py-3 font-mono text-xs text-accent whitespace-nowrap">
                {r.name}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                {r.type}
              </td>
              <td className="px-4 py-3 text-muted-foreground leading-relaxed">
                {r.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddressTable({
  rows,
}: {
  rows: { contract: string; address: string; network: string }[];
}) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="rounded-xl border border-border/70 overflow-hidden mb-6 shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary/40 border-b border-border/70">
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">
              Contract
            </th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">
              Network
            </th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">
              Address
            </th>
          </tr>
        </thead>
        <tbody className="bg-card/30">
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-b border-border/40 last:border-0 hover:bg-secondary/20 transition-colors"
            >
              <td className="px-4 py-3 font-semibold text-foreground">
                {r.contract}
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px] uppercase font-semibold",
                    r.network === "Base Mainnet"
                      ? "bg-accent/15 text-accent border-accent/20"
                      : "bg-secondary text-muted-foreground border-border/50",
                  )}
                >
                  {r.network}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <code className="font-mono text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md border border-border/50">
                    {r.address}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(r.address);
                      setCopied(r.address);
                      setTimeout(() => setCopied(null), 2000);
                    }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied === r.address ? (
                      <Check className="w-4 h-4 text-accent" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Doc content ───────────────────────────────────────────────────────────────

function OverviewDoc() {
  return (
    <div>
      <SectionHeading title="What is ArcenPay?" breadcrumb="Getting Started" />
      <Lead>
        ArcenPay is an on-chain subscription billing protocol. Providers deploy
        plans on-chain, subscribers pay in USDC, and the protocol enforces
        billing intervals, feature entitlements, and gas sponsorship—all without
        a centralised payment processor.
      </Lead>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        {[
          {
            icon: Layers,
            title: "Plans",
            desc: "Deploy subscription tiers to PlanFactory on-chain.",
          },
          {
            icon: Users,
            title: "Subscribers",
            desc: "Track active, cancelled, and past-due subscriptions.",
          },
          {
            icon: ShieldCheck,
            title: "ZK Billing",
            desc: "Usage verified with ZK proofs via ZKUsageVerifier.",
          },
        ].map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="p-5 rounded-xl border border-border/70 bg-card/50 shadow-sm space-y-3 hover:border-accent/30 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shadow-inner">
              <Icon className="w-5 h-5 text-accent" />
            </div>
            <p className="text-base font-semibold text-foreground">{title}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {desc}
            </p>
          </div>
        ))}
      </div>

      <H3 id="end-to-end-flow">How it works end-to-end</H3>
      <div className="mb-6 space-y-4">
        {[
          "Provider connects wallet and creates a subscription plan on PlanFactory.",
          "Subscriber pays USDC and is registered in SubscriptionRegistry.",
          "FeeCollector deducts the platform fee (basis points) on every charge.",
          "SessionVault funds gas for sponsored transactions on L2 chains.",
          "ZKUsageVerifier accepts ZK proofs to trigger usage-based billing.",
          "Feature flags on Tableland gate app features per plan tier.",
        ].map((step, i) => (
          <div
            key={i}
            className="flex items-start gap-4 p-3 rounded-lg hover:bg-secondary/20 transition-colors border border-transparent hover:border-border/50"
          >
            <div className="flex items-center gap-1 mt-1 shrink-0 relative">
              <div className="w-5 h-5 rounded-full bg-accent/15 flex items-center justify-center border border-accent/30">
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              </div>
              {i < 5 && (
                <div className="w-[1.5px] h-8 bg-border/50 absolute top-[1.4rem] left-1/2 -translate-x-1/2" />
              )}
            </div>
            <p className="text-sm text-foreground/80 font-medium leading-relaxed">
              {step}
            </p>
          </div>
        ))}
      </div>

      <InfoBox>
        All contracts are deployed on Sepolia testnet. Base Sepolia and Base
        Mainnet deployments inherit the same ABI — swap the chain and address
        only.
      </InfoBox>
    </div>
  );
}

function PlansDoc() {
  return (
    <div>
      <SectionHeading title="Plans" breadcrumb="Core Concepts" />
      <Lead>
        A plan is an on-chain struct stored in PlanFactory. It defines the name,
        tier, USDC price, billing interval, and the accepted token address.
        Plans are immutable once created — archive and redeploy to change
        pricing.
      </Lead>

      <H3 id="creating-a-plan">Creating a plan</H3>
      <StepCard step={1} title="Open the Plans section">
        Navigate to <strong className="text-foreground">Catalog → Plans</strong>{" "}
        in the sidebar and click{" "}
        <strong className="text-foreground">Create Plan</strong>.
      </StepCard>
      <StepCard step={2} title="Fill in plan details">
        Enter a plan name (e.g.{" "}
        <code className="font-mono text-accent text-xs bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20">
          Pro
        </code>
        ), a USDC price, and choose a billing interval: Monthly (30d), Quarterly
        (90d), or Annual (365d).
      </StepCard>
      <StepCard step={3} title="Select the accepted token">
        Choose the USDC contract for the chain your subscribers will pay on.
        Sepolia, Base Sepolia, and Base Mainnet USDC addresses are pre-filled.
      </StepCard>
      <StepCard step={4} title="Deploy on-chain">
        Click <strong className="text-foreground">Deploy Plan</strong>. Your
        wallet will prompt a transaction calling{" "}
        <code className="font-mono text-accent text-xs bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20">
          PlanFactory.createPlan()
        </code>
        . Estimated gas: ~120,000 units.
      </StepCard>

      <H3 id="contract-call-signature">Contract call signature</H3>
      <CodeBlock
        lang="solidity"
        code={`function createPlan(
    string  calldata name,
    string  calldata tier,
    uint256          price,       // USDC with 6 decimals
    uint256          billingInterval, // seconds
    address          acceptedToken,
    string  calldata metadataURI
) external returns (uint256 planId);`}
      />

      <H3 id="plan-lifecycle">Plan lifecycle</H3>
      <PropTable
        rows={[
          {
            name: "active",
            type: "bool",
            description: "Plan accepts new subscribers when true.",
          },
          {
            name: "price",
            type: "uint256",
            description:
              "USDC amount in 6-decimal units (e.g. 9_990_000 = $9.99).",
          },
          {
            name: "billingInterval",
            type: "uint256",
            description: "Seconds between billing cycles.",
          },
          {
            name: "acceptedToken",
            type: "address",
            description: "ERC-20 token charged at billing time (always USDC).",
          },
          {
            name: "metadataURI",
            type: "string",
            description: "Optional IPFS/HTTPS URI for off-chain plan metadata.",
          },
        ]}
      />

      <InfoBox>
        Archiving a plan calls{" "}
        <code className="font-mono text-xs">deactivatePlan(planId)</code>.
        Existing subscribers retain access until their period expires; no new
        subscriptions are accepted.
      </InfoBox>
    </div>
  );
}

function SubscriptionsDoc() {
  return (
    <div>
      <SectionHeading title="Subscriptions" breadcrumb="Core Concepts" />
      <Lead>
        SubscriptionRegistry tracks every subscriber per provider. Subscriptions
        move through a defined lifecycle — active, past-due, cancelled — all
        verifiable on-chain.
      </Lead>

      <H3 id="subscription-lifecycle">Subscription lifecycle</H3>
      <div className="flex items-center gap-2 flex-wrap mb-8 bg-card/30 p-4 rounded-xl border border-border/50">
        {["Active", "Past-due", "Cancelled", "Expired"].map((s, i, arr) => (
          <div key={s} className="flex items-center gap-3">
            <span
              className={cn(
                "text-sm px-3 py-1.5 rounded-full font-semibold border shadow-sm",
                s === "Active"
                  ? "bg-green-500/10 text-green-500 border-green-500/20"
                  : s === "Past-due"
                    ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                    : s === "Cancelled"
                      ? "bg-red-500/10 text-red-500 border-red-500/20"
                      : "bg-secondary/80 text-muted-foreground border-border/70",
              )}
            >
              {s}
            </span>
            {i < arr.length - 1 && (
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        ))}
      </div>

      <H3 id="querying-subscribers">Querying subscribers (subgraph)</H3>
      <CodeBlock
        lang="graphql"
        code={`query GetSubscribers($provider: String!) {
  subscriptions(
    where: { provider: $provider }
    orderBy: createdAt
    orderDirection: desc
  ) {
    id
    subscriber
    planId
    status          # ACTIVE | PAST_DUE | CANCELLED
    startedAt
    nextBillingAt
    totalPaid       # cumulative USDC (6 decimals)
  }
}`}
      />

      <H3 id="on-chain-check">On-chain subscriber check (SDK)</H3>
      <CodeBlock
        lang="ts"
        code={`import { useReadContract } from "wagmi";
import { SubscriptionRegistryABI } from "@arcenpay/sdk";

const { data: isActive } = useReadContract({
  address: "0xf45A9E5280F72260a713c50b0Ca4e4FB1e22Cc8A",
  abi:     SubscriptionRegistryABI,
  functionName: "isSubscribed",
  args:    [planId, subscriberAddress],
});`}
      />

      <InfoBox>
        The dashboard Subscribers tab polls the subgraph. On-chain reads via
        wagmi are available for latency-critical gates.
      </InfoBox>
    </div>
  );
}

function SessionsDoc() {
  return (
    <div>
      <SectionHeading
        title="Sessions & Gas Sponsorship"
        breadcrumb="Core Concepts"
      />
      <Lead>
        SessionVault lets providers pre-fund a gas budget so subscribers pay
        zero gas on L2 chains. Deposits are in ETH (native); the facilitator
        relays transactions and deducts from the vault balance.
      </Lead>

      <H3 id="how-gas-sponsorship-works">How gas sponsorship works</H3>
      <StepCard step={1} title="Deposit into SessionVault">
        Send ETH to{" "}
        <code className="font-mono text-accent text-xs bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20">
          SessionVault.deposit()
        </code>
        . The dashboard Sessions page shows your current balance.
      </StepCard>
      <StepCard step={2} title="Facilitator relays transactions">
        When a subscriber triggers a billing event, the facilitator submits the
        tx and deducts gas cost from your vault balance.
      </StepCard>
      <StepCard step={3} title="ZK usage proofs">
        Off-chain usage (API calls, compute minutes) is committed as a ZK proof
        and submitted to ZKUsageVerifier, which triggers billing without
        exposing raw usage data.
      </StepCard>
      <StepCard step={4} title="Withdraw anytime">
        Call{" "}
        <code className="font-mono text-accent text-xs bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20">
          SessionVault.withdraw(amount)
        </code>{" "}
        to reclaim unspent ETH.
      </StepCard>

      <H3 id="vault-interface">Vault contract interface</H3>
      <CodeBlock
        lang="solidity"
        code={`// Deposit ETH for gas sponsorship
function deposit() external payable;

// Withdraw ETH back to provider
function withdraw(uint256 amount) external;

// Read provider balance
function balanceOf(address provider) external view returns (uint256);`}
      />

      <H3 id="gas-budget-tiers">Gas budget tiers</H3>
      <PropTable
        rows={[
          { name: "Free", type: "$0/day", description: "No gas sponsorship." },
          {
            name: "Pro",
            type: "$5/day",
            description: "Covers ~2,000 L2 txs/day.",
          },
          {
            name: "Enterprise",
            type: "$25/day",
            description: "Covers ~10,000 L2 txs/day.",
          },
        ]}
      />
    </div>
  );
}

function FeaturesDoc() {
  return (
    <div>
      <SectionHeading title="Feature Flags" breadcrumb="Core Concepts" />
      <Lead>
        Feature flags are stored on Tableland — a decentralised SQL network. The
        facilitator API exposes them via{" "}
        <code className="font-mono text-xs text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded border border-border/50">
          /api/tableland/flags
        </code>
        . Use flags to gate product features per plan tier without a re-deploy.
      </Lead>

      <H3 id="flag-schema">Flag schema</H3>
      <PropTable
        rows={[
          {
            name: "key",
            type: "string",
            description: "Unique flag identifier, e.g. advanced_analytics.",
          },
          {
            name: "enabled",
            type: "boolean",
            description: "Global on/off switch.",
          },
          {
            name: "planTiers",
            type: "string[]",
            description:
              "Plans that inherit this flag (e.g. ['pro','enterprise']).",
          },
          {
            name: "rollout",
            type: "number",
            description: "0–100 percentage rollout to subscribers.",
          },
        ]}
      />

      <H3 id="reading-flags">Reading flags in your app</H3>
      <CodeBlock
        lang="ts"
        code={`// Server-side
const res = await fetch(
  \`\${process.env.FACILITATOR_URL}/api/tableland/flags\`,
  { headers: { Authorization: \`Bearer \${process.env.FACILITATOR_API_KEY}\` } }
);
const { flags } = await res.json();
const canUseAnalytics = flags.find(f => f.key === "advanced_analytics")?.enabled;`}
      />

      <H3 id="meap-react-hook">@arcenpay/react hook</H3>
      <CodeBlock
        lang="tsx"
        code={`import { useFeatureFlag } from "@arcenpay/react";

function AnalyticsDashboard() {
  const enabled = useFeatureFlag("advanced_analytics");
  if (!enabled) return <UpgradePrompt />;
  return <Charts />;
}`}
      />

      <InfoBox>
        Flag changes from the dashboard Features tab propagate to Tableland
        within ~30 seconds. No code deploy is required.
      </InfoBox>
    </div>
  );
}

function SDKDoc() {
  return (
    <div>
      <SectionHeading title="SDK Reference" breadcrumb="Developers" />
      <Lead>
        ArcenPay ships four packages:{" "}
        <code className="font-mono text-xs text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded border border-border/50">
          @arcenpay/sdk
        </code>{" "}
        for contract ABIs and chain constants,{" "}
        <code className="font-mono text-xs text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded border border-border/50">
          @arcenpay/react
        </code>{" "}
        for drop-in UI components and hooks,{" "}
        <code className="font-mono text-xs text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded border border-border/50">
          @arcenpay/node
        </code>{" "}
        for server-side middleware and services, and{" "}
        <code className="font-mono text-xs text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded border border-border/50">
          @arcenpay/agent
        </code>{" "}
        for autonomous AI agent payments.
      </Lead>

      {/* Package overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
        {[
          {
            pkg: "@arcenpay/sdk",
            badge: "Core",
            badgeColor: "bg-violet-500/10 text-violet-500 border-violet-500/20",
            desc: "Contract ABIs, addresses, chain constants, and TypeScript types. Zero runtime dependencies.",
            icon: "⬡",
          },
          {
            pkg: "@arcenpay/react",
            badge: "React",
            badgeColor: "bg-blue-500/10 text-blue-500 border-blue-500/20",
            desc: "Drop-in UI components (PricingTable, CheckoutModal, ArcenEmbed) and wagmi-based hooks.",
            icon: "⚛",
          },
          {
            pkg: "@arcenpay/node",
            badge: "Server",
            badgeColor: "bg-green-500/10 text-green-500 border-green-500/20",
            desc: "Express/Fastify middleware, x402 payment verification, webhooks, and event services.",
            icon: "⬛",
          },
          {
            pkg: "@arcenpay/agent",
            badge: "AI",
            badgeColor: "bg-orange-500/10 text-orange-500 border-orange-500/20",
            desc: "Autonomous AI agent that self-funds sessions and pays x402 APIs without human approval.",
            icon: "🤖",
          },
        ].map((p) => (
          <div
            key={p.pkg}
            className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card/50 hover:border-border/80 hover:bg-card transition-all duration-200"
          >
            <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center text-lg shrink-0">
              {p.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <code className="text-xs font-mono font-semibold text-foreground">
                  {p.pkg}
                </code>
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${p.badgeColor}`}
                >
                  {p.badge}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {p.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      <H3 id="installation">Installation</H3>
      <InfoBox>
        All packages require <strong>wagmi v2</strong> and{" "}
        <strong>viem v2</strong> as peer dependencies. React packages
        additionally require <strong>React 18+</strong>.
      </InfoBox>
      <CodeBlock
        lang="bash"
        code={`# Install everything
npm install @arcenpay/sdk @arcenpay/react @arcenpay/node wagmi viem

# Or pick only what you need
npm install @arcenpay/sdk              # ABIs + addresses only
npm install @arcenpay/react wagmi viem # React UI + hooks
npm install @arcenpay/node             # Server middleware`}
      />

      <StepCard step={1} title="Wrap your app with ArcenPayProvider">
        The provider injects the current chain's contract addresses and connects
        to your ArcenPay workspace.
      </StepCard>
      <CodeBlock
        lang="tsx"
        code={`import { ArcenPayProvider } from '@arcenpay/react';
import { WagmiProvider, createConfig } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const wagmiConfig = createConfig({ chains: [base, baseSepolia], /* ... */ });
const queryClient = new QueryClient();

export default function App({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ArcenPayProvider
          apiKey={process.env.NEXT_PUBLIC_ARCENPAY_API_KEY!}
          environment="production"   // "development" | "production"
        >
          {children}
        </ArcenPayProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}`}
      />

      <H3 id="core-exports">@arcenpay/sdk — Core Exports</H3>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
        Pure utility package — no React dependency, works in Node, browsers, and
        edge runtimes.
      </p>
      <PropTable
        rows={[
          {
            name: "getContractAddresses(chainId)",
            type: "function",
            description:
              "Returns all deployed contract addresses for Sepolia, Base Sepolia, or Base Mainnet.",
          },
          {
            name: "SUPPORTED_CHAINS",
            type: "number[]",
            description:
              "Array of chain IDs that ArcenPay is deployed on: [11155111, 84532, 8453].",
          },
          {
            name: "TOKENS[chainId].USDC",
            type: "address",
            description: "USDC token address per supported chain.",
          },
          {
            name: "PlanFactoryABI",
            type: "ABI",
            description:
              "Full ABI for PlanFactory.sol — create and manage on-chain subscription plans.",
          },
          {
            name: "SubscriptionRegistryABI",
            type: "ABI",
            description:
              "Full ABI for SubscriptionRegistry.sol — mint/renew subscriptions and check status.",
          },
          {
            name: "FeeCollectorABI",
            type: "ABI",
            description:
              "Full ABI for FeeCollector.sol — collect and withdraw protocol fees.",
          },
          {
            name: "SessionVaultABI",
            type: "ABI",
            description:
              "Full ABI for SessionVault.sol — deposit ETH for gas sponsorship.",
          },
          {
            name: "ZKUsageVerifierABI",
            type: "ABI",
            description:
              "Full ABI for ZKUsageVerifier.sol — verify zero-knowledge usage proofs.",
          },
          {
            name: "ERC7579AutopayModuleABI",
            type: "ABI",
            description:
              "Full ABI for ERC-7579 autopay module — automated recurring payments.",
          },
          {
            name: "isChainSupported(chainId)",
            type: "function",
            description: "Returns true if the given chainId is supported.",
          },
        ]}
      />
      <CodeBlock
        lang="ts"
        code={`import { getContractAddresses, PlanFactoryABI, TOKENS } from "@arcenpay/sdk";

// Get addresses for Base Mainnet (8453)
const { planFactory, subscriptionRegistry, feeCollector } =
  getContractAddresses(8453);

// USDC address on Base Sepolia
const usdcAddress = TOKENS[84532].USDC;
// → "0x036CbD53842c5426634e7929541eC2318f3dCF7e"`}
      />

      <H3 id="react-components">@arcenpay/react — UI Components</H3>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        Pre-built, customisable billing UI components. Each accepts a{" "}
        <code className="font-mono text-xs bg-secondary/50 px-1 py-0.5 rounded border border-border/50">
          design
        </code>{" "}
        prop for full theme control.
      </p>

      {/* Component cards */}
      <div className="space-y-4 mb-8">
        {[
          {
            name: "PricingTable",
            desc: "Renders your published plans as an interactive pricing table. Users can click to open CheckoutModal.",
            props: [
              {
                name: "planIds?",
                type: "string[]",
                description:
                  "Filter to specific plan IDs. Defaults to all published plans.",
              },
              {
                name: "onSelect?",
                type: "(planId: string) => void",
                description:
                  "Called when user clicks a plan. Opens CheckoutModal by default.",
              },
              {
                name: "design?",
                type: "ComponentDesign",
                description:
                  "Theme tokens: primaryColor, fontFamily, cardStyle, etc.",
              },
              {
                name: "columns?",
                type: "1 | 2 | 3 | 4",
                description:
                  "Number of plan columns. Defaults to auto (up to 3).",
              },
            ],
            code: `import { PricingTable } from "@arcenpay/react";

export function Pricing() {
  return (
    <PricingTable
      columns={3}
      design={{ primaryColor: "#6366f1", fontFamily: "Inter" }}
      onSelect={(planId) => console.log("Selected:", planId)}
    />
  );
}`,
          },
          {
            name: "CheckoutModal",
            desc: "Full checkout flow modal — wallet connect → approve USDC → mint subscription NFT. Handles ERC-4337 smart accounts automatically.",
            props: [
              {
                name: "planId",
                type: "string",
                description: "The plan ID to subscribe to.",
              },
              {
                name: "open",
                type: "boolean",
                description: "Controls modal visibility.",
              },
              {
                name: "onClose",
                type: "() => void",
                description: "Called when the modal is dismissed.",
              },
              {
                name: "onSuccess?",
                type: "(result: CheckoutResult) => void",
                description: "Called after successful subscription.",
              },
              {
                name: "onError?",
                type: "(err: CheckoutFlowError) => void",
                description: "Called on payment failure.",
              },
              {
                name: "design?",
                type: "ComponentDesign",
                description: "Theme overrides.",
              },
            ],
            code: `import { CheckoutModal } from "@arcenpay/react";

export function SubscribeButton({ planId }: { planId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Subscribe</button>
      <CheckoutModal
        planId={planId}
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={(result) => {
          console.log("Subscribed! TxHash:", result.txHash);
          setOpen(false);
        }}
      />
    </>
  );
}`,
          },
          {
            name: "ArcenEmbed / ArcenpayEmbed",
            desc: "Server-rendered embed component for customer portals. Fetches element config via access token — drop into any page.",
            props: [
              {
                name: "id",
                type: "string",
                description: "Component ID from the Components dashboard.",
              },
              {
                name: "accessToken",
                type: "string",
                description:
                  "Short-lived token from POST /api/v1/access-tokens.",
              },
              {
                name: "baseUrl?",
                type: "string",
                description:
                  "Your ArcenPay API base URL. Defaults to https://api.arcenpay.xyz.",
              },
              {
                name: "initialView?",
                type: "'portal' | 'checkout' | 'payment' | 'unsubscribe'",
                description: "Which view to show on mount.",
              },
            ],
            code: `import { ArcenpayEmbed } from "@arcenpay/react";

// ─── Step 1: Generate a token SERVER-SIDE (e.g. Next.js API route) ───────────
// This auto-creates the company if it doesn't exist and assigns a free plan.

// app/api/billing-token/route.ts
export async function GET(req: Request) {
  const session = await getSession(req); // your auth

  const res = await fetch("https://dashboard.arcenpay.xyz/api/v1/access-tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: \`Bearer \${process.env.ARCENPAY_API_KEY}\`, // api_xxx
    },
    body: JSON.stringify({
      company: {
        id: session.userId,          // your internal user/company ID
        email: session.email,        // optional — used for display
        name: session.orgName,       // optional — company display name
      },
      // user: { id: session.userId, email: session.email }, // optional user record
      expires_in: 3600,              // 1 hour (60–86400)
    }),
  });

  const { data } = await res.json();
  return Response.json({ token: data.token });
}

// ─── Step 2: Fetch token client-side and render the embed ─────────────────────

export function BillingPortal() {
  const [token, setToken] = React.useState("");

  React.useEffect(() => {
    fetch("/api/billing-token")
      .then((r) => r.json())
      .then((d) => setToken(d.token));
  }, []);

  if (!token) return null;

  return (
    <ArcenpayEmbed
      componentId="cmn_xxxxxxxxxxxxxxxx"  // from Components dashboard
      accessToken={token}
      baseUrl="https://dashboard.arcenpay.xyz"
    />
  );
}`,
          },
          {
            name: "SubscriptionStatus",
            desc: "Badge/chip showing the current subscription state for the connected wallet.",
            props: [
              {
                name: "planId",
                type: "string",
                description: "The plan to check subscription status for.",
              },
              {
                name: "variant?",
                type: "'badge' | 'card'",
                description: "Display variant. Defaults to badge.",
              },
            ],
            code: `import { SubscriptionStatus } from "@arcenpay/react";

export function Header() {
  return (
    <nav>
      <SubscriptionStatus planId="plan_pro" variant="badge" />
    </nav>
  );
}`,
          },
          {
            name: "FeatureFlagGuard",
            desc: "Conditionally renders children based on a feature flag value for the connected wallet.",
            props: [
              {
                name: "flag",
                type: "string",
                description: "Feature flag key to evaluate.",
              },
              {
                name: "fallback?",
                type: "React.ReactNode",
                description:
                  "Rendered when flag is disabled. Defaults to null.",
              },
              {
                name: "children",
                type: "React.ReactNode",
                description: "Rendered when flag is enabled.",
              },
            ],
            code: `import { FeatureFlagGuard } from "@arcenpay/react";

export function AnalyticsDashboard() {
  return (
    <FeatureFlagGuard
      flag="advanced_analytics"
      fallback={<UpgradePrompt />}
    >
      <Analytics />
    </FeatureFlagGuard>
  );
}`,
          },
        ].map((comp) => (
          <div
            key={comp.name}
            className="rounded-xl border border-border overflow-hidden bg-card"
          >
            <div className="flex items-start gap-3 px-5 py-4 border-b border-border bg-secondary/20">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-sm font-mono font-bold text-foreground">
                    {`<${comp.name} />`}
                  </code>
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-blue-500/10 text-blue-500 border-blue-500/20"
                  >
                    Component
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {comp.desc}
                </p>
              </div>
            </div>
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
              {/* Props table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="text-left px-4 py-2 font-semibold text-muted-foreground">
                        Prop
                      </th>
                      <th className="text-left px-4 py-2 font-semibold text-muted-foreground">
                        Type
                      </th>
                      <th className="text-left px-4 py-2 font-semibold text-muted-foreground">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comp.props.map((p, i) => (
                      <tr
                        key={i}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="px-4 py-2 font-mono text-accent whitespace-nowrap">
                          {p.name}
                        </td>
                        <td className="px-4 py-2 font-mono text-muted-foreground whitespace-nowrap">
                          {p.type}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground leading-relaxed">
                          {p.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Code example */}
              <div className="relative bg-[#0A0A0B]">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-[#121214]">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider font-semibold">
                    tsx
                  </span>
                </div>
                <pre className="p-4 text-[12px] font-mono text-gray-300 overflow-x-auto leading-relaxed whitespace-pre">
                  {comp.code}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>

      <H3 id="react-hooks">@arcenpay/react — Hooks</H3>
      <PropTable
        rows={[
          {
            name: "useArcenPay()",
            type: "hook",
            description:
              "Returns the full ArcenPay context: apiKey, environment, and helper methods.",
          },
          {
            name: "useContractAddresses()",
            type: "hook",
            description:
              "Returns all contract addresses for the wallet's connected chain. Falls back to Sepolia if not connected.",
          },
          {
            name: "useEntitlement(key)",
            type: "hook",
            description:
              "Returns { value, loading, error } for a named entitlement on the connected wallet. Reads from Tableland cache.",
          },
          {
            name: "useFlag(key)",
            type: "hook",
            description:
              "Shorthand boolean hook: returns true/false for a feature flag. Re-renders on flag change.",
          },
          {
            name: "useTrack()",
            type: "hook",
            description:
              "Returns a track(event, props) function to send analytics events to the events stream.",
          },
        ]}
      />
      <CodeBlock
        lang="tsx"
        code={`import { useEntitlement, useFlag, useTrack } from "@arcenpay/react";

export function Dashboard() {
  // Entitlement with quantity
  const { value: apiLimit, loading } = useEntitlement("api_calls_per_month");

  // Simple boolean flag
  const canExport = useFlag("csv_export");

  // Event tracking
  const track = useTrack();

  const handleExport = () => {
    track("export_triggered", { format: "csv" });
    // ...
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <p>API calls remaining: {apiLimit ?? "unlimited"}</p>
      {canExport && <button onClick={handleExport}>Export CSV</button>}
    </div>
  );
}`}
      />

      <H3 id="node-sdk">@arcenpay/node — Server SDK</H3>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
        Server-side utilities for Express, Fastify, and edge runtimes. Handles
        x402 payment verification, webhook signing, and event ingestion.
      </p>
      <PropTable
        rows={[
          {
            name: "ArcenPayClient",
            type: "class",
            description:
              "Main server client. Accepts apiKey and environment. Exposes events, flags, companies, users, and webhooks services.",
          },
          {
            name: "x402Middleware(options)",
            type: "middleware",
            description:
              "Express/Fastify middleware that verifies x402 payment headers on each request.",
          },
          {
            name: "arcenPayMiddleware(options)",
            type: "middleware",
            description:
              "Full middleware bundle: access-token verification + company lookup + entitlement injection.",
          },
          {
            name: "verifyWebhookSignature(payload, secret)",
            type: "function",
            description:
              "Verifies an incoming webhook's HMAC-SHA256 signature.",
          },
          {
            name: "client.events.track(event)",
            type: "method",
            description:
              "Ingest a track event server-side (e.g. after billing events).",
          },
          {
            name: "client.flags.evaluate(key, company)",
            type: "method",
            description:
              "Server-side feature flag evaluation against targeting rules.",
          },
        ]}
      />
      <CodeBlock
        lang="ts"
        code={`import express from "express";
import { ArcenPayClient, x402Middleware, arcenPayMiddleware } from "@arcenpay/node";

const client = new ArcenPayClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  environment: "production",
});

const app = express();

// ── x402: Gate a route with USDC micropayment ──────────────────
app.use("/api/premium", x402Middleware({
  client,
  planId: "plan_pro",
  chainId: 8453,             // Base Mainnet
}));

// ── Full middleware: verify access token + inject entitlements ──
app.use("/app", arcenPayMiddleware({ client }));

app.get("/app/dashboard", (req, res) => {
  // req.arcenpay.company   — identified company
  // req.arcenpay.flags     — evaluated feature flags
  // req.arcenpay.planTier  — e.g. "pro"
  const canSeeAnalytics = req.arcenpay.flags["advanced_analytics"];
  res.json({ canSeeAnalytics });
});

// ── Webhooks: verify + handle ───────────────────────────────────
app.post("/webhooks/arcenpay", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["x-arcenpay-signature"] as string;
  const isValid = client.webhooks.verify(req.body, sig, process.env.WEBHOOK_SECRET!);
  if (!isValid) return res.status(400).send("Invalid signature");

  const event = JSON.parse(req.body.toString());
  if (event.type === "subscription.created") {
    await provisionUserAccess(event.data.subscriber);
  }
  res.sendStatus(200);
});`}
      />

      <H3 id="quick-start">End-to-End Quick Start</H3>
      <InfoBox>
        This example shows a full stack: Next.js frontend with PricingTable +
        CheckoutModal, and a Node.js backend that issues access tokens and
        verifies webhooks.
      </InfoBox>
      <StepCard step={1} title="Install packages">
        <></>
      </StepCard>
      <CodeBlock
        lang="bash"
        code={`npm install @arcenpay/sdk @arcenpay/react @arcenpay/node wagmi viem @tanstack/react-query`}
      />

      <StepCard step={2} title="Backend: issue access tokens">
        <></>
      </StepCard>
      <CodeBlock
        lang="ts"
        code={`// app/api/access-token/route.ts  (Next.js App Router)
import { ArcenPayClient } from "@arcenpay/node";

const client = new ArcenPayClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  environment: "production",
});

export async function POST(req: Request) {
  const { companyId } = await req.json();
  const { token } = await client.accessTokens.create({
    companyId,
    expiresIn: 3600,  // 1 hour
  });
  return Response.json({ token });
}`}
      />

      <StepCard step={3} title="Frontend: show pricing + handle checkout">
        <></>
      </StepCard>
      <CodeBlock
        lang="tsx"
        code={`"use client";
import { useState } from "react";
import { PricingTable, CheckoutModal } from "@arcenpay/react";

export function PricingPage() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  return (
    <>
      <PricingTable
        columns={3}
        design={{ primaryColor: "#6366f1" }}
        onSelect={(planId) => setSelectedPlan(planId)}
      />
      {selectedPlan && (
        <CheckoutModal
          planId={selectedPlan}
          open={!!selectedPlan}
          onClose={() => setSelectedPlan(null)}
          onSuccess={({ txHash }) => {
            console.log("Subscription minted:", txHash);
            setSelectedPlan(null);
          }}
        />
      )}
    </>
  );
}`}
      />

      <StepCard step={4} title="Gate features with entitlements">
        <></>
      </StepCard>
      <CodeBlock
        lang="tsx"
        code={`import { FeatureFlagGuard, useEntitlement } from "@arcenpay/react";

export function AppShell() {
  const { value: seats } = useEntitlement("team_seats");

  return (
    <div>
      {/* Gate entire sections */}
      <FeatureFlagGuard flag="analytics" fallback={<UpgradePrompt />}>
        <AnalyticsDashboard />
      </FeatureFlagGuard>

      {/* Use entitlement values */}
      <TeamInviteButton maxSeats={seats ?? 1} />
    </div>
  );
}`}
      />
    </div>
  );
}

function ContractsDoc() {
  return (
    <div>
      <SectionHeading title="Contract Addresses" breadcrumb="Developers" />
      <Lead>
        All production contracts are verified on their respective block
        explorers. Use these addresses directly in wagmi/viem or via{" "}
        <code className="font-mono text-xs text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded border border-border/50">
          getContractAddresses(chainId)
        </code>{" "}
        from{" "}
        <code className="font-mono text-xs text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded border border-border/50">
          @arcenpay/sdk
        </code>
        .
      </Lead>

      <H3 id="sepolia">Sepolia (testnet)</H3>
      <AddressTable
        rows={[
          {
            contract: "PlanFactory",
            network: "Sepolia",
            address: "0xc736f5d91aC0039b97A4Fc3540B8f3d59E7FdBa6",
          },
          {
            contract: "SubscriptionRegistry",
            network: "Sepolia",
            address: "0xf45A9E5280F72260a713c50b0Ca4e4FB1e22Cc8A",
          },
          {
            contract: "FeeCollector",
            network: "Sepolia",
            address: "0x513fab5218045790364b33A38D95FE8E17403BAe",
          },
          {
            contract: "SessionVault",
            network: "Sepolia",
            address: "0x2dccEaad8551a620E4Fc736bb4d0fbb8D1A17D7C",
          },
          {
            contract: "ZKUsageVerifier",
            network: "Sepolia",
            address: "0x265E0dC80b00044d183AFa83237F5976bB4d585c",
          },
          {
            contract: "ERC7579AutopayModule",
            network: "Sepolia",
            address: "0x3f3734fb45D1511c23384D18Eb1927492E5e3764",
          },
          {
            contract: "MirrorRegistry",
            network: "Sepolia",
            address: "0x05BdaB1b4A87a4a5DF3Af1Ebb9Da853A0d31592E",
          },
          {
            contract: "USDC",
            network: "Sepolia",
            address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
          },
        ]}
      />

      <H3 id="base-sepolia">Base Sepolia (testnet)</H3>
      <AddressTable
        rows={[
          {
            contract: "USDC",
            network: "Base Sepolia",
            address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          },
        ]}
      />

      <H3 id="base-mainnet">Base (mainnet)</H3>
      <AddressTable
        rows={[
          {
            contract: "USDC",
            network: "Base Mainnet",
            address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          },
        ]}
      />

      <div className="my-10 border-t border-border/40" />

      <H3 id="block-explorers">Block explorers</H3>
      <div className="space-y-3">
        {[
          { label: "Sepolia Etherscan", url: "https://sepolia.etherscan.io" },
          { label: "Base Sepolia Scan", url: "https://sepolia.basescan.org" },
          { label: "BaseScan", url: "https://basescan.org" },
        ].map((e) => (
          <a
            key={e.url}
            href={e.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-accent transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {e.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DocsSection() {
  const [active, setActive] = useState<DocSection>("overview");

  const content: Record<DocSection, React.ReactNode> = {
    overview: <OverviewDoc />,
    plans: <PlansDoc />,
    subscriptions: <SubscriptionsDoc />,
    sessions: <SessionsDoc />,
    features: <FeaturesDoc />,
    sdk: <SDKDoc />,
    contracts: <ContractsDoc />,
  };

  return (
    <div className="flex gap-12 min-h-[calc(100vh-8rem)] items-start pt-4">
      {/* Left nav */}
      <aside className="w-56 shrink-0 sticky top-4 hidden md:block border-r border-border/40 pr-6 h-[calc(100vh-10rem)] overflow-y-auto no-scrollbar pb-10">
        <div className="space-y-8">
          {DOC_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-xs font-bold text-foreground mb-3 px-3 uppercase tracking-wider text-muted-foreground/80">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map(({ id, label }) => {
                  const isActive = active === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setActive(id as DocSection)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        isActive
                          ? "bg-accent/15 text-accent shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="pt-6 border-t border-border/40">
            <a
              href="https://github.com/your-org/arcenpay"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              <Terminal className="w-4 h-4" />
              GitHub Repository
            </a>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 max-w-3xl pb-24">
        <div
          key={active}
          className="animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out"
        >
          {content[active]}
        </div>
      </div>

      {/* Right TOC */}
      <aside className="w-56 shrink-0 sticky top-6 hidden xl:block h-[calc(100vh-12rem)] overflow-y-auto pt-2">
        <p className="text-sm font-semibold text-foreground mb-4">
          On this page
        </p>
        <div className="flex flex-col space-y-3 border-l-2 border-border/30">
          {TOC[active].map((item, index) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={cn(
                "pl-4 text-sm font-medium transition-colors",
                index === 0
                  ? "text-accent border-l-2 border-accent -ml-[2px]"
                  : "text-muted-foreground hover:text-foreground border-l-2 border-transparent -ml-[2px]",
              )}
            >
              {item.label}
            </a>
          ))}
        </div>
      </aside>
    </div>
  );
}
