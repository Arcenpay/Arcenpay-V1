"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { EarthGlobe } from "./earth-globe";

export function CtaSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.2 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="relative py-32 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div
          className={`relative rounded-2xl overflow-hidden transition-all duration-1000 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
        >
          {/* Dark background for globe contrast */}
          <div className="absolute inset-0 bg-[#0a0a0a]" />

          <div className="relative z-10 px-8 lg:px-16 py-16 lg:py-12">
            <div className="flex items-center justify-between gap-8">
              <div className="max-w-xl relative z-20">
                <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight mb-6 text-white text-balance">
                  Start monetizing on-chain, today.
                </h2>

                <p className="text-lg text-white/60 mb-8 leading-relaxed max-w-lg">
                  Deploy subscription plans, gate premium features, and bill AI agents —
                  all with trustless, on-chain infrastructure.
                </p>

                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <Button
                    size="lg"
                    className="bg-white hover:bg-white/90 text-black px-6 h-12 text-sm font-medium group"
                  >
                    Launch Dashboard
                    <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 px-6 text-sm font-medium border-white/20 text-white hover:bg-white/10 bg-transparent"
                  >
                    Read the Docs
                  </Button>
                </div>

                <p className="text-sm text-white/40 mt-6 font-mono">
                  No centralized infrastructure needed
                </p>
              </div>

              {/* Interactive 3D Earth Globe */}
              <div className="hidden lg:block flex-1 max-w-[550px]">
                <EarthGlobe className="w-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
