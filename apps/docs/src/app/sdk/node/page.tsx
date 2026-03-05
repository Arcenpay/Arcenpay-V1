// ============================================================
//  Documentation — @meap/node SDK Reference
//  PRD Section 5.2: Backend & Facilitator SDK
// ============================================================

export default function NodeSDKPage() {
  return (
    <>
      <h1>@meap/node</h1>
      <p>Backend SDK for x402 middleware, usage logging, proof generation, and settlement monitoring.</p>

      <pre><code>npm install @meap/node</code></pre>

      <h2>x402 Middleware</h2>
      <p>Drop-in Express middleware for x402 payment-gated API endpoints.</p>
      <pre><code>{`import { x402Middleware } from '@meap/node';

// Gate a premium endpoint
app.use('/api/premium', x402Middleware({
  planId: 'pro',
  ratePerCall: '0.001',    // USDC per call
  network: 'base-mainnet',
  payTo: '0xFacilitatorContract...',
}));

// Your route handler runs after payment is validated
app.get('/api/premium/data', (req, res) => {
  res.json({ premium: true, data: '...' });
});`}</code></pre>

      <h2>UsageService</h2>
      <p>Usage logging and zk-SNARK proof generation for ZKVUB sessions.</p>
      <pre><code>{`import { UsageService } from '@meap/node';

const usage = new UsageService({
  proofMode: 'strict',
  circuitWasmPath: './circuits/build/UsageBilling_js/UsageBilling.wasm',
  zkeyPath: './circuits/build/circuit_final.zkey',
  verificationKeyPath: './circuits/build/verification_key.json',
  signerPrivateKey: process.env.PRIVATE_KEY,
});

// Log API consumption
await usage.logUsage(sessionId, {
  endpoint: '/api/compute',
  method: 'POST',
  timestamp: Date.now(),
});

// Generate zk-SNARK proof for a billing window
const { proof, publicInputs } = await usage.generateProof(
  sessionId,
  windowEnd
);

// Submit proof to ZKUsageVerifier.sol
const settlement = await usage.submitProof(proof, publicInputs);`}</code></pre>

      <h2>SettlementService</h2>
      <p>Monitor on-chain settlements and query session vault balances.</p>
      <pre><code>{`import { SettlementService } from '@meap/node';

const settlements = new SettlementService({
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  zkVerifierAddress: '0x265E0dC8...',
  sessionVaultAddress: '0x2dccEaad...',
});

// Query agent's session vault balance
const balance = await settlements.getSessionBalance('0xAgentAddress');

// Watch for on-chain BillingSettled events
const unsubscribe = settlements.watchSettlements((event) => {
  console.log('Settlement:', event.sessionId, event.settlementAmount);
});

// Stop watching
unsubscribe();`}</code></pre>

      <h2>Facilitator Node</h2>
      <p>The Facilitator Node is a deployable Docker service that validates x402 payments and submits them on-chain.</p>
      <pre><code>{`# Run with Docker Compose
cd apps/facilitator
docker-compose up -d

# Or run directly
PORT=3402 npm run dev`}</code></pre>
    </>
  );
}
