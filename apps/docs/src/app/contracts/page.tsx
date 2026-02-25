// ============================================================
//  Documentation — Contract Reference
//  PRD Section 4: All 7 deployed contracts with addresses
// ============================================================

export default function ContractsPage() {
  const contracts = [
    { name: 'PlanFactory', address: '0xc736f5d91aC0039b97A4Fc3540B8f3d59E7FdBa6', purpose: 'SaaS provider plan configuration and deployment' },
    { name: 'FeeCollector', address: '0x513fab5218045790364b33A38D95FE8E17403BAe', purpose: 'Protocol fee collection (0.5% subscriptions, 0.3% settlements)' },
    { name: 'SubscriptionRegistry', address: '0xf45A9E5280F72260a713c50b0Ca4e4FB1e22Cc8A', purpose: 'ERC-5643 subscription NFT lifecycle management' },
    { name: 'SessionVault', address: '0x2dccEaad8551a620E4Fc736bb4d0fbb8D1A17D7C', purpose: 'Pre-funded USDC vault for ZKVUB billing sessions' },
    { name: 'ZKUsageVerifier', address: '0x265E0dC80b00044d183AFa83237F5976bB4d585c', purpose: 'On-chain zk-SNARK proof verification and settlement' },
    { name: 'ERC7579AutopayModule', address: '0x3f3734fb45D1511c23384D18Eb1927492E5e3764', purpose: 'Automated recurring billing for ERC-7579 smart accounts' },
    { name: 'MirrorRegistry', address: '0x05BdaB1b4A87a4a5DF3Af1Ebb9Da853A0d31592E', purpose: 'Cross-chain entitlement state mirror' },
  ];

  return (
    <>
      <h1>Smart Contracts</h1>
      <p>All 7 core contracts deployed on Sepolia ETH (chainId 11155111).</p>

      <div className="callout info">
        <strong>Network:</strong> Sepolia Testnet &bull;
        <strong> Chain ID:</strong> 11155111 &bull;
        <strong> USDC:</strong> <code>0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238</code>
      </div>

      <h2>Deployed Addresses</h2>
      <table className="contract-table">
        <thead>
          <tr>
            <th>Contract</th>
            <th>Address</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <tr key={c.name}>
              <td><strong>{c.name}</strong></td>
              <td><code style={{ fontSize: 11 }}>{c.address}</code></td>
              <td style={{ color: '#8b949e', fontSize: 13 }}>{c.purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>SubscriptionRegistry</h2>
      <p>ERC-5643 extension for subscription NFT lifecycle management. Mints time-constrained NFTs upon payment that serve as on-chain proof of subscription status.</p>
      <h3>Key Functions</h3>
      <pre><code>{`// Mint a new subscription NFT
function mint(address to, uint256 planId, uint64 duration) → uint256 tokenId

// Extend subscription expiry
function renew(uint256 tokenId, uint64 extension)

// Cancel subscription (access until period end)
function cancel(uint256 tokenId)

// Check if subscription is currently active
function isValid(uint256 tokenId) → bool

// Get subscription expiry timestamp
function expiresAt(uint256 tokenId) → uint64`}</code></pre>

      <h2>ERC7579AutopayModule</h2>
      <p>ERC-7579 Executor module for automated recurring billing. Installed into smart accounts to authorize constrained pull payments.</p>
      <h3>Configuration</h3>
      <pre><code>{`struct AutopayConfig {
  address merchant;    // Provider's billing contract
  uint256 maxAmount;   // Max pull per interval (USDC base units)
  address token;       // Approved stablecoin (USDC)
  uint32 interval;     // Min 2,592,000s (30 days)
  uint64 startTime;    // Must be >= block.timestamp
  uint256 planId;      // Reference to PlanFactory plan
}`}</code></pre>

      <h2>ZKUsageVerifier</h2>
      <p>On-chain Groth16 zk-SNARK verification for usage-based billing. Verifies proofs and executes precise settlements.</p>
      <h3>Key Functions</h3>
      <pre><code>{`// Submit proof for verification and settlement
function submitProof(Proof proof, PublicInputs inputs)

// Check if a nullifier has been used (double-spend prevention)
function isNullifierUsed(bytes32 nullifier) → bool

// Get rate schedule for a plan
function getRateSchedule(uint256 planId) → uint256 ratePerCall`}</code></pre>

      <h2>SessionVault</h2>
      <p>Pre-funded USDC vault for ZKVUB billing sessions. Agents deposit stablecoins, and settlement occurs from vault balances.</p>
      <h3>Key Functions</h3>
      <pre><code>{`// Fund a new session
function fundSession(uint256 amount, address token) → bytes32 sessionId

// Settle from session vault (called by authorized settlers)
function settle(bytes32 sessionId, uint256 amount, address provider)

// Withdraw remaining balance
function withdraw(bytes32 sessionId)

// Query agent balance
function getAgentBalance(address agent) → uint256`}</code></pre>

      <h2>Post-Deployment Wiring</h2>
      <p>After deployment, contracts are wired together:</p>
      <ul>
        <li><strong>AutopayModule</strong> → authorized as biller on SubscriptionRegistry</li>
        <li><strong>AutopayModule</strong> → authorized as collector on FeeCollector</li>
        <li><strong>ZKUsageVerifier</strong> → authorized as settler on SessionVault</li>
        <li><strong>ZKUsageVerifier</strong> → authorized as collector on FeeCollector</li>
      </ul>
    </>
  );
}
