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

export default function ContractsIndexPage() {
  const contracts = [
    { name: 'PlanFactory', href: '/contracts/plan-factory', desc: 'Creates and manages on-chain subscription plans. Provider registration, token allowlist.', badge: 'MEAP' },
    { name: 'SubscriptionRegistry', href: '/contracts/subscription-registry', desc: 'ERC-721 + ERC-5643 subscription NFT lifecycle. Mint, renew, cancel, cross-chain dispatch.', badge: 'MEAP' },
    { name: 'ERC7579AutopayModule', href: '/contracts/autopay-module', desc: 'Executor module for ERC-7579 smart accounts. Automated recurring billing with velocity limits.', badge: 'MEAP' },
    { name: 'SessionVault', href: '/contracts/session-vault', desc: 'Pre-funded USDC vault for ZKVUB sessions. Fund, top-up, settle, withdraw.', badge: 'ZKVUB' },
    { name: 'ZKUsageVerifier', href: '/contracts/zk-usage-verifier', desc: 'On-chain Groth16 zk-SNARK proof verification and usage-based settlement.', badge: 'ZKVUB' },
    { name: 'FeeCollector', href: '/contracts/fee-collector', desc: 'Protocol fee collection. Tier-based rates, per-provider overrides, treasury withdrawal.', badge: 'SHARED' },
    { name: 'MirrorRegistry', href: '/contracts/mirror-registry', desc: 'Cross-chain subscription state mirror. Axelar primary + CCIP fallback GMP transport.', badge: 'SHARED' },
  ];

  const badgeColors: Record<string, { bg: string; color: string }> = {
    MEAP: { bg: 'rgba(99,102,241,0.1)', color: '#6366f1' },
    ZKVUB: { bg: 'rgba(14,165,233,0.1)', color: '#0ea5e9' },
    SHARED: { bg: 'rgba(16,185,129,0.1)', color: '#10b981' },
  };

  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Contracts</div>
        <div className="docs-page-title-row"><h1>Contract Reference</h1></div>

        <p className="docs-lead" id="contracts">
          ArcenPay is composed of 7 auditable Solidity contracts deployed on Sepolia ETH.<br />
          All contracts use Solidity 0.8.24 with OpenZeppelin 5.x base contracts.
        </p>

        <h2 id="contract-list">All contracts</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
          {contracts.map(({ name, href, desc, badge }) => (
            <a key={name} href={href} style={{ display: 'flex', gap: 12, padding: '16px 20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, textDecoration: 'none', color: 'inherit', transition: 'border-color 0.15s' }}
               onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
               onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 14, color: 'var(--txt)' }}>{name}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: badgeColors[badge].bg, color: badgeColors[badge].color }}>{badge}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--txt-muted)', lineHeight: 1.5 }}>{desc}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', color: 'var(--txt-muted)' }}>→</div>
            </a>
          ))}
        </div>

        <h2 id="inheritance">Inheritance & dependencies</h2>
        <table className="docs-table">
          <thead><tr><th>Contract</th><th>Inherits</th><th>Depends on</th></tr></thead>
          <tbody>
            <tr><td>PlanFactory</td><td>Ownable, ReentrancyGuard</td><td>—</td></tr>
            <tr><td>SubscriptionRegistry</td><td>ERC721, ERC721Enumerable, IERC5643, Ownable, ReentrancyGuard</td><td>PlanFactory</td></tr>
            <tr><td>ERC7579AutopayModule</td><td>ReentrancyGuard</td><td>PlanFactory, SubscriptionRegistry, FeeCollector</td></tr>
            <tr><td>SessionVault</td><td>Ownable, ReentrancyGuard</td><td>—</td></tr>
            <tr><td>ZKUsageVerifier</td><td>Ownable, ReentrancyGuard</td><td>SessionVault, FeeCollector, PlanFactory, IGroth16Verifier</td></tr>
            <tr><td>FeeCollector</td><td>Ownable, ReentrancyGuard</td><td>—</td></tr>
            <tr><td>MirrorRegistry</td><td>Ownable</td><td>—</td></tr>
          </tbody>
        </table>

        <h2 id="solidity-version">Solidity version</h2>
        <CodeBlock lang="bash" code={`# Compile all contracts
cd packages/contracts
npm install
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to Sepolia
npx hardhat run scripts/deploy.ts --network sepolia`} />
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#contracts">Contract Reference</a></li>
          <li className="docs-toc-item"><a href="#contract-list">All contracts</a></li>
          <li className="docs-toc-item"><a href="#inheritance">Inheritance</a></li>
          <li className="docs-toc-item"><a href="#solidity-version">Compile & test</a></li>
        </ul>
      </nav>
    </div>
  );
}
