import { Hero } from "@/components/hero";
import { ProtocolOverview } from "@/components/protocol-overview";
import { HowItWorks } from "@/components/how-it-works";
import { StatsBar } from "@/components/stats-bar";
import { IntegrationSnippet } from "@/components/integration-snippet";
import { Github } from "lucide-react";

export default function LandingPage() {
  return (
    <main>
      <Hero />
      <StatsBar />
      <ProtocolOverview />
      <HowItWorks />
      <IntegrationSnippet />

      {/* Footer */}
      <footer className="border-t border-zinc-800 py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-white font-semibold">ArcenPay</p>
            <p className="text-zinc-500 text-sm mt-1">The Web3 Billing Layer</p>
          </div>
          <div className="flex items-center gap-6 text-sm text-zinc-500">
            <a href="https://docs.arcenpay.xyz" className="hover:text-white transition-colors">Docs</a>
            <a href="https://arcenpay-dashboard.vercel.app" className="hover:text-white transition-colors">Dashboard</a>
            <a
              href="https://github.com/arcenpay"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors flex items-center gap-1.5"
            >
              <Github className="w-4 h-4" />
              GitHub
            </a>
          </div>
          <p className="text-zinc-600 text-sm">© 2026 ArcenPay. MIT License.</p>
        </div>
      </footer>
    </main>
  );
}
