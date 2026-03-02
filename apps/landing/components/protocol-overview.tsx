import { CreditCard, Cpu } from "lucide-react";

const MEAP_FEATURES = [
  "ERC-721 subscription NFTs",
  "ERC-7579 autopay module",
  "Cross-chain entitlement sync (Axelar + CCIP)",
  "Tableland + Lit Protocol feature flags",
  "CheckoutModal — 3-line integration",
];

const ZKVUB_FEATURES = [
  "x402 payment protocol for AI agents",
  "Groth16 zk-SNARK usage proofs",
  "Per-call metered billing",
  "SessionVault with USDC",
  "ZKUsageVerifier on-chain settlement",
];

export function ProtocolOverview() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">Two billing primitives. One protocol.</h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
            MEAP powers recurring subscriptions. ZKVUB enables metered AI billing.
            Both deployed on Sepolia, composable by design.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* MEAP */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 hover:border-blue-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">MEAP</h3>
                <p className="text-sm text-zinc-400">Modular EVM Autopay Protocol</p>
              </div>
            </div>
            <p className="text-zinc-400 mb-6 leading-relaxed">
              Subscription billing for Web3 SaaS. Providers create plans on PlanFactory,
              subscribers mint NFT access tokens, autopay pulls tokens on schedule.
            </p>
            <ul className="space-y-2">
              {MEAP_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* ZKVUB */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 hover:border-cyan-500/30 transition-colors">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">ZKVUB</h3>
                <p className="text-sm text-zinc-400">Zero-Knowledge Usage Billing</p>
              </div>
            </div>
            <p className="text-zinc-400 mb-6 leading-relaxed">
              Metered billing for AI agents using zk-SNARKs. Agents fund a SessionVault,
              make x402 API calls, and settle via Groth16 proofs — no per-call transactions.
            </p>
            <ul className="space-y-2">
              {ZKVUB_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
