// ============================================================
//  Documentation — Architecture Overview
//  PRD Section 3: MEAP + ZKVUB architecture breakdown
// ============================================================

export default function ArchitecturePage() {
  return (
    <>
      <h1>Architecture</h1>
      <p>The protocol comprises two interconnected subsystems sharing common infrastructure.</p>

      <h2>MEAP — Modular Entitlement and Access Protocol</h2>
      <p>Handles automated recurring billing and cryptographic feature gating for human users and DAOs.</p>

      <h3>Three Layers</h3>
      <ol>
        <li><strong>Smart Account Layer (ERC-7579)</strong> — Replaces EOAs with modular smart accounts. The AutopayModule executor grants constrained pull-payment authority.</li>
        <li><strong>Entitlement State Layer (ERC-5643 + Tableland)</strong> — Time-constrained NFTs for on-chain subscription status. Tableland for granular feature flags.</li>
        <li><strong>Access Control Layer (Lit Protocol)</strong> — MPC-based decryption key provisioning. Premium content encrypted; keys only released when ACCs are satisfied.</li>
      </ol>

      <h3>MEAP End-to-End Flow</h3>
      <pre><code>{`User Wallet (EOA)
  → Deploy ERC-7579 Smart Account (ZeroDev)
  → Install MEAP AutopayModule
  → Provider Billing Contract
  → Pull USDC at interval
  → Mint/Renew ERC-5643 NFT
  → Write feature flags to Tableland
  → Emit GMP message (Axelar)
  → MirrorRegistry (all chains)
  → Lit Protocol ACCs evaluate NFT + Tableland
  → Decryption Key Provisioned
  → User Access Granted`}</code></pre>

      <h2>ZKVUB — Zero-Knowledge Verifiable Usage Billing</h2>
      <p>Handles metered, usage-based billing for AI agents using x402 and zk-SNARK proofs.</p>

      <h3>Four Layers</h3>
      <ol>
        <li><strong>x402 Machine Payment Layer</strong> — HTTP-native payment negotiation. Server returns 402 with pricing, agent responds with X-PAYMENT header.</li>
        <li><strong>Off-Chain Aggregation Layer</strong> — Client pre-funds SessionVault. API calls metered off-chain with signed consumption logs.</li>
        <li><strong>Zero-Knowledge Proof Layer</strong> — Groth16 zk-SNARK proves consumption without revealing individual request data.</li>
        <li><strong>On-Chain Settlement Layer</strong> — ZKUsageVerifier validates proof, calculates amount, and executes precise USDC transfer.</li>
      </ol>

      <h3>ZKVUB End-to-End Flow</h3>
      <pre><code>{`AI Agent
  → Fund SessionVault with USDC
  → Call API endpoint
  → Receive HTTP 402 (x402 response)
  → Construct X-PAYMENT header
  → Facilitator Node validates + submits on-chain
  → API access granted
  → Usage logged off-chain
  → Threshold reached
  → Prover generates Groth16 zk-SNARK
  → Proof submitted to ZKUsageVerifier
  → Verified on-chain
  → Precise USDC settlement from SessionVault
  → BillingSettled event emitted`}</code></pre>

      <h2>Cross-Chain Interoperability</h2>
      <p>Subscription state purchased on one chain is mirrored to all other chains via General Message Passing (GMP).</p>
      <ul>
        <li><strong>Axelar Network</strong> — Proof-of-stake validated message passing (primary)</li>
        <li><strong>Chainlink CCIP</strong> — Oracle-validated cross-chain messaging (secondary)</li>
        <li><strong>MirrorRegistry</strong> — Deployed on each target chain, receives state updates</li>
      </ul>

      <h2>Technology Stack</h2>
      <table className="contract-table">
        <thead><tr><th>Layer</th><th>Technology</th></tr></thead>
        <tbody>
          <tr><td>Primary Chain</td><td>Sepolia ETH (testnet) → Base (production)</td></tr>
          <tr><td>Smart Contracts</td><td>Solidity 0.8.24</td></tr>
          <tr><td>Account Abstraction</td><td>ERC-7579 (ZeroDev)</td></tr>
          <tr><td>Subscription NFT</td><td>ERC-5643</td></tr>
          <tr><td>Access Control</td><td>Lit Protocol (MPC/TEE)</td></tr>
          <tr><td>Feature Flags DB</td><td>Tableland</td></tr>
          <tr><td>Cross-Chain</td><td>Axelar GMP + Chainlink CCIP</td></tr>
          <tr><td>Machine Payments</td><td>x402 Protocol</td></tr>
          <tr><td>ZK Proofs</td><td>Groth16 / Circom</td></tr>
          <tr><td>Frontend</td><td>React 19 + TypeScript</td></tr>
          <tr><td>Wallet</td><td>Wagmi v2 + viem</td></tr>
          <tr><td>Backend</td><td>Node.js + Express</td></tr>
          <tr><td>Testing</td><td>Hardhat + Foundry + Vitest</td></tr>
        </tbody>
      </table>
    </>
  );
}
