import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ArcenPay Docs — MEAP + ZKVUB Protocol',
  description: 'Developer documentation for the Web3 Entitlement Layer',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="docs-layout">
          <aside className="docs-sidebar">
            <div className="docs-brand">⬡ <span>ArcenPay Docs</span></div>

            <div className="docs-nav-section">
              <h4>Getting Started</h4>
              <a href="/" className="docs-nav-link">Introduction</a>
              <a href="/quickstart" className="docs-nav-link">Quick Start</a>
              <a href="/architecture" className="docs-nav-link">Architecture</a>
            </div>

            <div className="docs-nav-section">
              <h4>SDK Reference</h4>
              <a href="/sdk/react" className="docs-nav-link">@arcenpay/react</a>
              <a href="/sdk/node" className="docs-nav-link">@arcenpay/node</a>
              <a href="/sdk/agent" className="docs-nav-link">@arcenpay/agent</a>
              <a href="/sdk/core" className="docs-nav-link">@arcenpay/sdk</a>
            </div>

            <div className="docs-nav-section">
              <h4>Smart Contracts</h4>
              <a href="/contracts" className="docs-nav-link">Overview</a>
              <a href="/contracts/subscription-registry" className="docs-nav-link">SubscriptionRegistry</a>
              <a href="/contracts/autopay-module" className="docs-nav-link">AutopayModule</a>
              <a href="/contracts/plan-factory" className="docs-nav-link">PlanFactory</a>
              <a href="/contracts/session-vault" className="docs-nav-link">SessionVault</a>
              <a href="/contracts/zk-verifier" className="docs-nav-link">ZKUsageVerifier</a>
            </div>

            <div className="docs-nav-section">
              <h4>Protocols</h4>
              <a href="/protocols/meap" className="docs-nav-link">MEAP Protocol</a>
              <a href="/protocols/zkvub" className="docs-nav-link">ZKVUB Protocol</a>
              <a href="/protocols/x402" className="docs-nav-link">x402 Standard</a>
            </div>
          </aside>

          <main className="docs-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
