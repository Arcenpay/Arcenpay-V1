"use client";

import { useState, useEffect } from "react";
import { Star } from "lucide-react";
import { CanvasRevealEffect } from "@/components/ui/canvas-reveal-effect";

export const AUTH_TESTIMONIALS = [
  {
    quote:
      "ArcenPay helped us move 10x faster with our billing infrastructure. While others are bogged down with payment integrations, we're shipping new features.",
    name: "Sophie Hall",
    role: "Founder, Catalog",
    company: "Web3 Design Agency",
    initials: "SH",
  },
  {
    quote:
      "The subscription NFT integration was seamless. We went from concept to production billing in under a week. Our users love the transparent on-chain receipts.",
    name: "Marcus Chen",
    role: "CTO, BlockForge",
    company: "DeFi Infrastructure",
    initials: "MC",
  },
  {
    quote:
      "Finally a billing layer that actually understands Web3. The ZK proof settlement cut our gas costs by 60% and our users never have to leave the app.",
    name: "Aisha Patel",
    role: "Head of Product, Nexus",
    company: "Gaming Studio",
    initials: "AP",
  },
];

export function AuthMarketingPanel() {
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setIsFading(true);
      window.setTimeout(() => {
        setActiveTestimonial((prev) => (prev + 1) % AUTH_TESTIMONIALS.length);
        setIsFading(false);
      }, 400);
    }, 6000);
    return () => window.clearInterval(interval);
  }, []);

  const testimonial = AUTH_TESTIMONIALS[activeTestimonial];

  return (
    <div className="hidden lg:flex lg:w-1/2 text-gray-900 relative overflow-hidden">
      {/* Dot-matrix reveal background */}
      <div className="absolute inset-0">
        <CanvasRevealEffect
          opacities={[0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1]}
          colors={[
            [0, 0, 253],
            [37, 99, 235],
            [6, 182, 212],
          ]} // brand #0000FD, blue-600, cyan-500
          dotSize={3}
          showGradient={true}
          containerClassName="h-full w-full"
        />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-end p-12">
        {/* Stars */}
        <div className="flex items-center gap-1 mb-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} className="w-4 h-4 fill-gray-900 text-gray-900" />
          ))}
        </div>

        {/* Auto-rotating testimonial with fade */}
        <div
          className={`transition-opacity duration-400 ${
            isFading ? "opacity-0" : "opacity-100"
          }`}
        >
          <blockquote className="text-2xl font-medium leading-relaxed mb-8 max-w-md">
            {testimonial.quote}
          </blockquote>

          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-brand flex items-center justify-center">
              <span className="text-sm font-semibold text-primary-foreground">
                {testimonial.initials}
              </span>
            </div>
            <div>
              <p className="font-semibold">{testimonial.name}</p>
              <p className="text-sm text-gray-900/60">{testimonial.role}</p>
              <p className="text-sm text-gray-900/40">{testimonial.company}</p>
            </div>
          </div>
        </div>

        {/* Pagination dots */}
        <div className="flex items-center gap-2 mt-8">
          {AUTH_TESTIMONIALS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => {
                setIsFading(true);
                window.setTimeout(() => {
                  setActiveTestimonial(idx);
                  setIsFading(false);
                }, 400);
              }}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === activeTestimonial
                  ? "w-6 bg-gray-900"
                  : "w-1.5 bg-gray-900/30"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
