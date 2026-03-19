'use client';
import { useState } from 'react';

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-codeblock">
      <div className="docs-codeblock-header">
        <span className="docs-codeblock-lang">{lang}</span>
        <button className="docs-codeblock-copy" onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export default function SDKReferencePage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Developers</div>
        <div className="docs-page-title-row">
          <h1>SDK Reference</h1>
        </div>

        <p className="docs-lead" id="sdk-reference">
          ArcenPay ships three SDK packages targeting different runtime environments.
          All packages are built on <strong>viem</strong> and share a common ABI layer generated from the deployed contracts.
        </p>

        <h2 id="packages">Packages</h2>
        <table className="docs-table">
          <thead><tr><th>Package</th><th>Runtime</th><th>Install</th></tr></thead>
          <tbody>
            <tr>
              <td><code>@meap/react</code></td>
              <td>Browser (React 18+)</td>
              <td><code>npm install @meap/react @meap/core viem wagmi</code></td>
            </tr>
            <tr>
              <td><code>@meap/node</code></td>
              <td>Node.js 18+</td>
              <td><code>npm install @meap/node viem</code></td>
            </tr>
            <tr>
              <td><code>@meap/agent</code></td>
              <td>AI Agents / Bun / Edge</td>
              <td><code>npm install @meap/agent viem</code></td>
            </tr>
          </tbody>
        </table>

        <h2 id="meap-react">@meap/react</h2>
        <p>React components and hooks for adding subscription billing to any dApp.</p>

        <h3>MEAPProvider</h3>
        <p>Wraps your app with contract configuration and wallet context. Must be placed above any <code>useSubscription</code> or <code>useFeatureFlag</code> calls.</p>
        <CodeBlock lang="TypeScript" code={`import { MEAPProvider } from '@meap/react';
import { WagmiProvider, createConfig } from 'wagmi';

const wagmiConfig = createConfig({ /* ... */ });

function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <MEAPProvider
        planFactoryAddress="0x18707519A062AbCC3E73fBd4150C3B30B241f536"
        registryAddress="0xA0Cf798816D4b9b9866b5704098F9C09F279c2C4"
        chainId={11155111}  // Sepolia
      >
        <YourApp />
      </MEAPProvider>
    </WagmiProvider>
  );
}`} />

        <h3>useSubscription</h3>
        <p>Returns the current wallet&apos;s subscription state.</p>
        <CodeBlock lang="TypeScript" code={`import { useSubscription } from '@meap/react';

const {
  isActive,      // boolean — wallet has a valid subscription
  tokenId,       // bigint | null — ERC-721 token ID
  planId,        // bigint | null — linked plan ID
  tier,          // string | null — plan tier (e.g. "pro")
  expiresAt,     // number | null — Unix timestamp
  isLoading,     // boolean
  error,         // Error | null
} = useSubscription();`} />

        <h3>useFeatureFlag</h3>
        <CodeBlock lang="TypeScript" code={`import { useFeatureFlag } from '@meap/react';

const {
  enabled,    // boolean
  isLoading,  // boolean
} = useFeatureFlag('analytics:export');`} />

        <h3>useFeatureFlags</h3>
        <CodeBlock lang="TypeScript" code={`import { useFeatureFlags } from '@meap/react';

const {
  flags,     // Record<string, boolean>
  isLoading, // boolean
} = useFeatureFlags(['analytics:export', 'api:webhooks', 'seats:unlimited']);`} />

        <h3>PricingTable</h3>
        <CodeBlock lang="TypeScript" code={`import { PricingTable } from '@meap/react';

<PricingTable
  planIds={[1, 2, 3]}                    // Plan IDs to display
  onSelectPlan={(planId) => void}        // Called on plan click
  highlightedPlanId={2}                  // Optional: highlight a plan
  showAnnualToggle={true}                // Show monthly/annual switch
/>`} />

        <h3>CheckoutModal</h3>
        <CodeBlock lang="TypeScript" code={`import { CheckoutModal } from '@meap/react';

<CheckoutModal
  planId={2}
  open={isOpen}
  onClose={() => setOpen(false)}
  onSuccess={(txHash) => {
    console.log('Subscribed! Tx:', txHash);
  }}
/>`} />

        <h2 id="meap-node">@meap/node</h2>
        <p>Server-side SDK for verifying subscriptions, evaluating flags, and listening to on-chain events.</p>

        <h3>createMEAPClient</h3>
        <CodeBlock lang="TypeScript" code={`import { createMEAPClient } from '@meap/node';

const meap = createMEAPClient({
  planFactoryAddress: process.env.PLAN_FACTORY_ADDRESS,
  registryAddress:    process.env.REGISTRY_ADDRESS,
  rpcUrl:             process.env.RPC_URL,
  chainId:            11155111,
});`} />

        <h3>meap.subscriptions.verify</h3>
        <CodeBlock lang="TypeScript" code={`// Verify a wallet has an active subscription (server-side)
const { isActive, tokenId, tier, expiresAt } =
  await meap.subscriptions.verify({ wallet: '0xABC...' });

// Use in middleware
app.use(async (req, res, next) => {
  const wallet = req.headers['x-wallet-address'];
  const { isActive } = await meap.subscriptions.verify({ wallet });
  if (!isActive) return res.status(401).json({ error: 'Subscription required' });
  next();
});`} />

        <h3>meap.featureFlags.evaluate</h3>
        <CodeBlock lang="TypeScript" code={`const { enabled } = await meap.featureFlags.evaluate({
  wallet: '0xABC...',
  flag: 'analytics:export',
});`} />

        <h3>meap.events.on</h3>
        <CodeBlock lang="TypeScript" code={`// Listen for subscription events
meap.events.on('SubscriptionMinted', (event) => {
  const { to, tokenId, planId, expiration } = event;
  // Provision access, send welcome email, etc.
});

meap.events.on('SubscriptionCancelled', ({ tokenId }) => {
  // Revoke access, send cancellation email
});`} />

        <h2 id="meap-agent">@meap/agent</h2>
        <p>SDK for AI agents making x402 HTTP payments and managing ZKVUB session vaults.</p>

        <h3>useSessionVault</h3>
        <CodeBlock lang="TypeScript" code={`import { useSessionVault } from '@meap/agent';
import { parseUnits } from 'viem';

const { fundSession, topUp, withdraw, getBalance } = useSessionVault({
  vaultAddress: process.env.SESSION_VAULT_ADDRESS,
  signerKey: process.env.AGENT_PRIVATE_KEY,
  rpcUrl: process.env.RPC_URL,
});

// Fund with $100 USDC
const sessionId = await fundSession({
  amount: parseUnits('100', 6),
  token: '0xusdc...',
});

// Query balance
const balance = await getBalance({ sessionId });
console.log('Remaining:', balance); // BigInt (USDC units)`} />

        <h3>x402Client</h3>
        <CodeBlock lang="TypeScript" code={`import { x402Client } from '@meap/agent';

const client = x402Client({
  sessionId,
  sessionVaultAddress: process.env.SESSION_VAULT_ADDRESS,
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

// Makes an HTTP request with automatic X-PAYMENT header negotiation
const response = await client.get('https://api.example.com/premium-data');
const data = await response.json();`} />

        <h2 id="error-codes">Error codes</h2>
        <table className="docs-table">
          <thead><tr><th>Code</th><th>Message</th><th>Cause</th></tr></thead>
          <tbody>
            <tr><td><code>MEAP_001</code></td><td>Not a provider</td><td>Wallet not registered as a provider with PlanFactory</td></tr>
            <tr><td><code>MEAP_002</code></td><td>Plan not found</td><td>planId does not exist or is invalid</td></tr>
            <tr><td><code>MEAP_003</code></td><td>Plan inactive</td><td>Plan has been deactivated via <code>deactivatePlan()</code></td></tr>
            <tr><td><code>MEAP_004</code></td><td>Token not approved</td><td>USDC address not in approved token list</td></tr>
            <tr><td><code>MEAP_005</code></td><td>Interval not elapsed</td><td>AutopayModule called before billing interval completed</td></tr>
            <tr><td><code>MEAP_006</code></td><td>Proof invalid</td><td>Groth16 proof verification failed in ZKUsageVerifier</td></tr>
            <tr><td><code>MEAP_007</code></td><td>Nullifier already used</td><td>Attempted double-spend of a zk-SNARK proof</td></tr>
            <tr><td><code>MEAP_008</code></td><td>Insufficient session balance</td><td>SessionVault balance too low for settlement amount</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#sdk-reference">SDK Reference</a></li>
          <li className="docs-toc-item"><a href="#packages">Packages</a></li>
          <li className="docs-toc-item"><a href="#meap-react">@meap/react</a></li>
          <li className="docs-toc-item"><a href="#meap-node">@meap/node</a></li>
          <li className="docs-toc-item"><a href="#meap-agent">@meap/agent</a></li>
          <li className="docs-toc-item"><a href="#error-codes">Error codes</a></li>
        </ul>
      </nav>
    </div>
  );
}
