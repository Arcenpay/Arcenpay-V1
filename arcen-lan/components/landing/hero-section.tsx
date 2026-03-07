"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { AsciiSphere } from "./ascii-sphere";
import { AsciiWave } from "./ascii-wave";
import { AsciiTorus } from "./ascii-torus";

export function HeroSection() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden pt-20">
      {/* Subtle grid */}
      <div className="absolute inset-0 grid-pattern opacity-50" />

      {/* ASCII Wave full width and height */}
      <div className="absolute inset-0 opacity-30 pointer-events-none overflow-hidden">
        <AsciiWave className="w-full h-full" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 py-12 lg:py-24">
        {/* Badge */}
        <div
          className={`flex justify-center mb-10 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5 text-sm font-mono text-primary">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            MEAP + ZKVUB Protocol — Live on Sepolia
          </div>
        </div>

        {/* Headline */}
        <div className="text-center max-w-5xl mx-auto mb-10">
          <h1
            className={`text-5xl md:text-7xl font-semibold tracking-tight leading-[0.95] mb-8 transition-all duration-700 delay-100 lg:text-7xl ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
          >
            <span className="text-balance">The decentralized billing</span>
            <br />
            <span className="text-balance">protocol for </span>{" "}
            <span className="text-primary">Web3.</span>
          </h1>

          <p
            className={`text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed transition-all duration-700 delay-200 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
          >
            Automated recurring payments via ERC-7579 smart accounts.
            Cryptographic feature gating with Lit Protocol.
            Zero-knowledge verifiable usage billing for AI agents.
          </p>
        </div>

        {/* CTAs */}
        <div
          className={`flex flex-col sm:flex-row items-center justify-center gap-3 mb-20 transition-all duration-700 delay-300 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
        >
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 h-11 text-sm font-medium group"
          >
            Launch Dashboard
            <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-11 px-6 text-sm font-medium border-border hover:bg-secondary/50 bg-transparent"
          >
            Read the Docs
          </Button>
        </div>


      </div>
    </section>
  );
}
