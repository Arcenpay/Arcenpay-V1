"use client";

import { useState } from "react";
import { AsciiDna } from "./ascii-dna";
import { Copy, Check } from "lucide-react";

const codeExamples = [
  {
    label: "Provider",
    code: `import { MEAPProvider } from '@meap/react'
import { base, sepolia } from 'wagmi/chains'

<MEAPProvider
  planRegistryAddress="0x1a2b...3c4d"
  supportedChains={[base, sepolia]}
  litNetwork="manzano"
>
  <App />
</MEAPProvider>`,
  },
  {
    label: "Checkout",
    code: `import { CheckoutModal } from '@meap/react'

<CheckoutModal
  planId={selectedPlan.id}
  onSuccess={(tokenId) => {
    // NFT minted — user is now subscribed
    router.push('/dashboard')
  }}
  onError={(error) => {
    toast.error(error.message)
  }}
/>`,
  },
  {
    label: "Entitlement",
    code: `import { useEntitlement } from '@meap/react'

const { isSubscribed, planTier, features,
        expiresAt, isLoading } =
  useEntitlement(walletAddress)

if (features.api_access) {
  return <PremiumContent />
}`,
  },
];

const features = [
  {
    title: "TypeScript-first",
    description: "Full type safety with auto-generated contract types and ABI imports."
  },
  {
    title: "React components",
    description: "Drop-in PricingTable, CheckoutModal, and FeatureFlagGuard — fully themeable."
  },
  {
    title: "useEntitlement hook",
    description: "On-chain NFT checks, Tableland flags, and real-time event subscriptions built in."
  },
  {
    title: "Agent SDK",
    description: "agent.fetch() handles x402 negotiation automatically — drop-in replacement for fetch()."
  },
];

export function DevelopersSection() {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(codeExamples[activeTab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="developers" className="relative py-32 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-start">
          {/* Left: Content */}
          <div>
            <p className="text-sm font-mono text-primary mb-3">// FOR DEVELOPERS</p>
            <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight mb-6 text-balance">
              30 minutes to<br />Web3 subscriptions.
            </h2>
            <p className="text-lg text-muted-foreground mb-10 leading-relaxed">
              All cryptographic complexity — modular accounts, zk-proofs,
              Lit Protocol — is abstracted behind typed TypeScript interfaces.
              You interact with React hooks, not Solidity ABIs.
            </p>

            {/* Features list */}
            <div className="grid gap-6">
              {features.map((feature) => (
                <div key={feature.title} className="flex gap-4">
                  <div className="w-1 bg-primary/30 rounded-full shrink-0" />
                  <div>
                    <h3 className="font-medium mb-1">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* ASCII DNA decoration */}

          </div>

          {/* Right: Code block */}
          <div className="lg:sticky lg:top-32">
            <div className="rounded-xl overflow-hidden border border-border card-shadow">
              {/* Dark header bar with traffic lights */}
              <div className="bg-[#2d2d2d] px-4 py-3 flex items-center">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                  <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
                </div>
                <span className="flex-1 text-center text-xs font-mono text-gray-400">
                  &gt;- ArcenPay SDK
                </span>
              </div>

              {/* Tabs + Copy button */}
              <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 bg-gray-50">
                {codeExamples.map((example, idx) => (
                  <button
                    key={example.label}
                    type="button"
                    onClick={() => setActiveTab(idx)}
                    className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${activeTab === idx
                      ? "bg-white text-foreground shadow-sm border border-gray-200"
                      : "text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    {example.label}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-white"
                  aria-label="Copy code"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-blue-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Code content — light gray background */}
              <div className="p-6 font-mono text-sm overflow-x-auto bg-[#f5f5f5]">
                <pre className="text-gray-700">
                  <code>
                    {codeExamples[activeTab].code.split('\n').map((line, i) => (
                      <div key={i} className="leading-relaxed">
                        <span className="text-gray-400 select-none w-8 inline-block text-right mr-4">{i + 1}</span>
                        <span
                          dangerouslySetInnerHTML={{
                            __html: highlightSyntax(line)
                          }}
                        />
                      </div>
                    ))}
                  </code>
                </pre>
              </div>

              {/* Terminal output — slightly darker gray */}
              <div className="border-t border-gray-200 p-4 bg-[#eaeaea]">
                <div className="flex items-center gap-2 text-xs font-mono text-gray-600 mb-1">
                  <span className="text-primary font-semibold">$</span>
                  <span>npm install @meap/react @meap/core viem wagmi</span>
                </div>
                <div className="text-xs font-mono text-gray-500">
                  added 4 packages in 1.2s
                </div>
              </div>
            </div>

            {/* Docs link */}
            <div className="mt-6 flex items-center gap-4 text-sm">
              <a href="#" className="text-primary hover:underline font-mono">
                Read the docs
              </a>
              <span className="text-border">|</span>
              <a href="#" className="text-muted-foreground hover:text-foreground font-mono">
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function highlightSyntax(line: string): string {
  // Escape HTML entities first
  let escaped = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Use a token-based approach to avoid regex interference
  const tokens: string[] = [];
  const placeholder = (html: string) => {
    const idx = tokens.length;
    tokens.push(html);
    return `\x00${idx}\x00`;
  };

  // 1. Strings first (highest priority)
  escaped = escaped.replace(/('.*?'|".*?")/g, (m) =>
    placeholder(`<span style="color:#2563eb">${m}</span>`)
  );

  // 2. Comments
  escaped = escaped.replace(/(\/\/.*$)/g, (m) =>
    placeholder(`<span style="color:#9ca3af">${m}</span>`)
  );

  // 3. Keywords
  escaped = escaped.replace(/\b(import|from|const|await|for|if|return)\b/g, (m) =>
    placeholder(`<span style="color:#3b3bbd;font-weight:500">${m}</span>`)
  );

  // 4. Brackets
  escaped = escaped.replace(/(\{|\}|\(|\)|\[|\])/g, (m) =>
    placeholder(`<span style="color:#6b7280">${m}</span>`)
  );

  // Restore tokens
  return escaped.replace(/\x00(\d+)\x00/g, (_, idx) => tokens[Number(idx)]);
}
