import { HeroSection } from "@/components/landing/hero-section";
import { LogosSection } from "@/components/landing/logos-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { FaqSection } from "@/components/landing/faq-section";
import { CtaSection } from "@/components/landing/cta-section";

export default function LandingPage() {
  return (
    <main className="flex-1">
      <HeroSection />
      <LogosSection />
      <FeaturesSection />
      <HowItWorksSection />
      <PricingSection />
      <FaqSection />
      <CtaSection />
    </main>
  );
}
