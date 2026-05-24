import {
  AnimatedHeader,
  AnimatedPricingWrapper,
} from "./pricing-section-client";
import { LockedPricingUI } from "./locked-pricing-ui";

export async function PricingSection() {
  return (
    <section
      id="pricing"
      className="w-full py-20 md:py-32 bg-muted/30 relative overflow-hidden flex justify-center items-center"
    >
      <div className="absolute inset-0 -z-10 h-full w-full bg-white dark:bg-black bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#1f1f1f_1px,transparent_1px),linear-gradient(to_bottom,#1f1f1f_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_50%,#000_40%,transparent_100%)]"></div>

      <div className="container px-4 md:px-6 relative">
        <AnimatedHeader />

        <AnimatedPricingWrapper>
          <LockedPricingUI />
        </AnimatedPricingWrapper>
      </div>
    </section>
  );
}
