// ============================================================
//  Documentation — Quick Start Guide
// ============================================================

export default function QuickStartPage() {
  return (
    <>
      <h1>Quick Start</h1>
      <p>Get from zero to a working Web3 subscription checkout in under 30 minutes.</p>

      <h2>1. Install Dependencies</h2>
      <pre><code>{`npm install @arcenpay/react @arcenpay/sdk viem`}</code></pre>

      <h2>2. Wrap Your App</h2>
      <pre><code>{`import { ArcenPayProvider } from '@arcenpay/react';

function App() {
  return (
    <ArcenPayProvider
      chainId={11155111}
      config={{
        tablelandConfig: {
          providerUrl: 'http://localhost:3402'
        },
        litConfig: {
          decryptEndpoint: 'http://localhost:3402/api/lit/decrypt'
        }
      }}
    >
      {/* Your app content */}
    </ArcenPayProvider>
  );
}`}</code></pre>

      <h2>3. Add Pricing Table</h2>
      <pre><code>{`import { PricingTable } from '@arcenpay/react';

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
      <pre><code>{`import { CheckoutModal } from '@arcenpay/react';

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
      <pre><code>{`import { FeatureFlagGuard } from '@arcenpay/react';

function PremiumContent() {
  const walletAddress = '0x1234...';
  return (
    <FeatureFlagGuard
      featureKey="analytics_dashboard"
      walletAddress={walletAddress}
      requireDecryption
      fallback={<UpgradePrompt />}
    >
      <AnalyticsDashboard />
    </FeatureFlagGuard>
  );
}`}</code></pre>

      <h2>6. Check Subscription Status</h2>
      <pre><code>{`import { useEntitlement } from '@arcenpay/react';

function ProfilePage() {
  const { isSubscribed, planTier, expiresAt, features, isLoading } =
    useEntitlement('0xYourWallet', 'analytics_dashboard');

  if (isLoading) return <Spinner />;
  if (!isSubscribed) return <SubscribePrompt />;

  return <div>Plan: {planTier} — Expires: {expiresAt}</div>;
}`}</code></pre>

      <div className="callout tip">
        <strong>Next Steps:</strong> Set up the backend with <code>@arcenpay/node</code> for
        x402 payment middleware, or integrate <code>@arcenpay/agent</code> for AI agent payments.
      </div>
    </>
  );
}
