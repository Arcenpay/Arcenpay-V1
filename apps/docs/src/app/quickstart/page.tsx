// ============================================================
//  Documentation — Quick Start Guide
// ============================================================

export default function QuickStartPage() {
  return (
    <>
      <h1>Quick Start</h1>
      <p>Get from zero to a working Web3 subscription checkout in under 30 minutes.</p>

      <h2>1. Install Dependencies</h2>
      <pre><code>{`npm install @meap/react @meap/core viem`}</code></pre>

      <h2>2. Wrap Your App</h2>
      <pre><code>{`import { MEAPProvider } from '@meap/react';

function App() {
  return (
    <MEAPProvider
      planRegistryAddress="0xc736f5d91aC0039b97A4Fc3540B8f3d59E7FdBa6"
      chainId={11155111}
      rpcUrl="https://ethereum-sepolia-rpc.publicnode.com"
    >
      {/* Your app content */}
    </MEAPProvider>
  );
}`}</code></pre>

      <h2>3. Add Pricing Table</h2>
      <pre><code>{`import { PricingTable } from '@meap/react';

function PricingPage() {
  return (
    <PricingTable
      planIds={[1, 2, 3]}
      onSelectPlan={(planId) => openCheckout(planId)}
      theme="dark"
    />
  );
}`}</code></pre>

      <h2>4. Add Checkout Modal</h2>
      <pre><code>{`import { CheckoutModal } from '@meap/react';

function Checkout({ planId }) {
  return (
    <CheckoutModal
      planId={planId}
      onSuccess={(tx) => {
        console.log('Subscription active!', tx.hash);
        // Redirect to dashboard
      }}
      onError={(err) => console.error(err)}
    />
  );
}`}</code></pre>

      <h2>5. Gate Premium Features</h2>
      <pre><code>{`import { FeatureFlagGuard } from '@meap/react';

function PremiumContent() {
  return (
    <FeatureFlagGuard
      featureKey="analytics_dashboard"
      fallback={<UpgradePrompt />}
    >
      <AnalyticsDashboard />
    </FeatureFlagGuard>
  );
}`}</code></pre>

      <h2>6. Check Subscription Status</h2>
      <pre><code>{`import { useEntitlement } from '@meap/react';

function ProfilePage() {
  const { isSubscribed, planTier, expiresAt, features, isLoading } =
    useEntitlement('0xYourWallet', 'analytics_dashboard');

  if (isLoading) return <Spinner />;
  if (!isSubscribed) return <SubscribePrompt />;

  return <div>Plan: {planTier} — Expires: {expiresAt}</div>;
}`}</code></pre>

      <div className="callout tip">
        <strong>Next Steps:</strong> Set up the backend with <code>@meap/node</code> for
        x402 payment middleware, or integrate <code>@meap/agent</code> for AI agent payments.
      </div>
    </>
  );
}
