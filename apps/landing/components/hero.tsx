"use client";

import { ArrowRight, Zap } from "lucide-react";

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Hexagon background motif */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute border border-blue-500/10 rounded-xl opacity-30"
            style={{
              width: `${180 + i * 100}px`,
              height: `${180 + i * 100}px`,
              top: "50%",
              left: "50%",
              transform: `translate(-50%, -50%) rotate(${i * 15}deg)`,
              animation: `spin ${20 + i * 5}s linear infinite ${i % 2 === 0 ? "" : "reverse"}`,
            }}
          />
        ))}
        <style>{`@keyframes spin { from { transform: translate(-50%, -50%) rotate(0deg); } to { transform: translate(-50%, -50%) rotate(360deg); } }`}</style>
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium mb-8">
          <Zap className="w-3.5 h-3.5" />
          Deployed on Sepolia — Live Contracts
        </div>

        <h1 className="text-6xl font-bold tracking-tight mb-6">
          <span className="text-white">The Web3</span>
          <br />
          <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            Billing Layer
          </span>
        </h1>

        <p className="text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Recurring subscription billing for SaaS on-chain (MEAP) and
          zero-knowledge metered billing for AI agents (ZKVUB) — all in one
          composable protocol.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="https://arcenpay-dashboard.vercel.app"
            className="flex items-center gap-2 px-8 py-4 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors"
          >
            Launch Dashboard
            <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="https://github.com/arcenpay"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-8 py-4 rounded-xl bg-zinc-800 border border-zinc-700 text-white font-semibold hover:bg-zinc-700 transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
