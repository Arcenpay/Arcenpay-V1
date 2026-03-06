"use client";

import { useEffect, useState, useRef } from "react";
import { AsciiDna } from "./ascii-dna";

const chains = [
  { name: "Base (Primary)", nodes: 5, latency: "< 2s" },
  { name: "Ethereum Mainnet", nodes: 4, latency: "< 15s" },
  { name: "Polygon", nodes: 3, latency: "< 3s" },
  { name: "Arbitrum", nodes: 3, latency: "< 2s" },
  { name: "Optimism", nodes: 2, latency: "< 2s" },
  { name: "Base Sepolia (Testnet)", nodes: 2, latency: "< 2s" },
];

export function InfrastructureSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="relative py-32 bg-muted/30 overflow-hidden">
      {/* ASCII DNA Background */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-10 pointer-events-none">
        <AsciiDna className="w-[600px] h-[500px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Content */}
          <div
            className={`transition-all duration-700 ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"
              }`}
          >
            <p className="text-sm font-mono text-primary mb-4">// PROTOCOL ARCHITECTURE</p>
            <h2 className="text-4xl lg:text-5xl font-semibold tracking-tight mb-6 text-balance">
              Protocol-native architecture.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8">
              Seven auditable smart contracts deployed across EVM chains.
              Cross-chain state sync via Axelar GMP ensures entitlements are
              recognized everywhere your users operate.
            </p>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <pre className="font-mono text-2xl text-primary">⚡</pre>
                <div>
                  <h3 className="font-semibold mb-1">Smart Account Layer</h3>
                  <p className="text-sm text-muted-foreground">
                    ERC-7579 modular accounts with ZeroDev Kernel for automated billing execution
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <pre className="font-mono text-2xl text-primary">🔄</pre>
                <div>
                  <h3 className="font-semibold mb-1">On-Chain Settlement</h3>
                  <p className="text-sm text-muted-foreground">
                    Groth16 zk-SNARK verification in ~200k gas with nullifier-based replay protection
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <pre className="font-mono text-2xl text-primary">🛡️</pre>
                <div>
                  <h3 className="font-semibold mb-1">Cross-Chain GMP</h3>
                  <p className="text-sm text-muted-foreground">
                    Axelar + Chainlink CCIP dual routing for multi-chain entitlement sync
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Chains Grid */}
          <div
            className={`transition-all duration-700 delay-200 ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
              }`}
          >
            <div className="grid grid-cols-1 gap-3">
              {chains.map((chain, index) => (
                <div
                  key={chain.name}
                  className="group relative bg-card rounded-lg p-5 border border-border card-shadow hover:border-primary/50 transition-all duration-300"
                  style={{ transitionDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold">{chain.name}</h4>
                    <span className="font-mono text-xs text-primary">{chain.latency}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {Array.from({ length: chain.nodes }).map((_, i) => (
                        <span
                          key={i}
                          className="w-2 h-2 rounded-full bg-primary/70 animate-pulse"
                          style={{ animationDelay: `${i * 200}ms` }}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">
                      {chain.nodes} {chain.nodes === 1 ? "contract" : "contracts"}
                    </span>
                  </div>

                  {/* Animated ASCII Network Visualization */}
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-30 transition-opacity font-mono text-xs text-primary">
                    <pre>{`
  ┌───┐
  │ ◉ │
  └─┬─┘
    │
`}</pre>
                  </div>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div className="mt-8 p-6 rounded-lg bg-foreground/5 border border-border">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="font-mono text-2xl font-semibold text-primary">7</div>
                  <div className="text-xs text-muted-foreground">Contracts</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold text-primary">99.99%</div>
                  <div className="text-xs text-muted-foreground">On-chain Uptime</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold text-primary">&lt;2s</div>
                  <div className="text-xs text-muted-foreground">Settlement</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
