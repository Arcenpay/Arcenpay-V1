// ============================================================
//  Documentation — @meap/react SDK Reference
//  PRD Section 5.1: Frontend Component Library
// ============================================================

export default function ReactSDKPage() {
  return (
    <>
      <h1>@meap/react</h1>
      <p>Frontend component library for Web3 subscription checkout and feature gating.</p>

      <pre><code>npm install @meap/react @meap/core viem</code></pre>

      <h2>MEAPProvider</h2>
      <p>Wrap your app to provide protocol context to all child components.</p>
      <pre><code>{`import { MEAPProvider } from '@meap/react';

<MEAPProvider
  planRegistryAddress="0xc736f5..."  // SubscriptionRegistry address
  chainId={11155111}                  // Sepolia
  rpcUrl="https://..."                // RPC endpoint
  litNetworkConfig={{ network: 'manzano' }}
>`}</code></pre>

      <h2>Components</h2>

      <h3>&lt;PricingTable /&gt;</h3>
      <p>Fetches plan data from PlanFactory and renders pricing tiers. Fully themeable.</p>
      <pre><code>{`<PricingTable
  planIds={[1, 2, 3]}          // Plan IDs from PlanFactory
  onSelectPlan={(id) => {}}    // Callback when user selects a plan
  theme="dark"                 // 'dark' | 'light'
/>`}</code></pre>

      <h3>&lt;CheckoutModal /&gt;</h3>
      <p>Handles wallet connection, ERC-7579 smart account deployment, and AutopayModule installation.</p>
      <pre><code>{`<CheckoutModal
  planId={1}                     // Plan to subscribe to
  onSuccess={(tx) => {}}         // Called after successful subscription
  onError={(err) => {}}          // Called on failure
/>`}</code></pre>

      <h3>&lt;SubscriptionStatus /&gt;</h3>
      <p>Displays current subscription tier, expiry date, and renewal status.</p>
      <pre><code>{`<SubscriptionStatus walletAddress="0x..." />`}</code></pre>

      <h3>&lt;FeatureFlagGuard /&gt;</h3>
      <p>Conditionally renders premium content based on on-chain entitlement state.</p>
      <pre><code>{`<FeatureFlagGuard
  featureKey="analytics_dashboard"
  fallback={<UpgradePrompt />}
>
  <PremiumContent />
</FeatureFlagGuard>`}</code></pre>

      <h3>&lt;UsageDashboard /&gt;</h3>
      <p>Displays real-time ZKVUB session usage metrics from Facilitator Node API.</p>
      <pre><code>{`<UsageDashboard
  sessionId="session_..."
  planId="1"
  facilitatorUrl="http://localhost:3001"
  pollInterval={5000}
/>`}</code></pre>

      <h3>&lt;BillingHistory /&gt;</h3>
      <p>Fetches and displays on-chain billing events from SubscriptionRegistry.</p>
      <pre><code>{`<BillingHistory
  walletAddress="0x..."
  maxEvents={20}
/>`}</code></pre>

      <h2>Hooks</h2>

      <h3>useEntitlement</h3>
      <p>Programmatic access to entitlement state for custom components.</p>
      <pre><code>{`const {
  isSubscribed,   // boolean
  planTier,       // 'starter' | 'pro' | 'enterprise'
  features,       // Record<string, boolean | string | number>
  expiresAt,      // bigint (Unix timestamp)
  isLoading,      // boolean
} = useEntitlement(walletAddress, featureKey);`}</code></pre>

      <div className="callout tip">
        The hook handles on-chain NFT validity checks, Tableland feature flag queries,
        caching with SWR, and real-time updates via contract event subscriptions.
      </div>
    </>
  );
}
