"use client";

import { useEffect, useRef, useState } from "react";

const steps = [
  {
    number: "01",
    title: "Install & Configure",
    description: "Add the SDK to your React app. Wrap your application in MEAPProvider — connects Wagmi, Lit Protocol, and chain configuration in a single component.",
    code: `import { MEAPProvider } from '@meap/react'

<MEAPProvider
  planRegistryAddress="0x1a2b...3c4d"
  supportedChains={[base, sepolia]}
  litNetwork="manzano"
/>`,
  },
  {
    number: "02",
    title: "Create Plans",
    description: "Deploy subscription tiers via PlanFactory. Define pricing, intervals, and feature flags that are enforced on-chain.",
    code: `const tx = await planFactory.write.createPlan({
  name: 'Pro',
  price: 29_000000n,  // 29 USDC
  interval: 2592000,  // 30 days
  features: ['api_access', 'analytics']
})`,
  },
  {
    number: "03",
    title: "Gate Content",
    description: "Use FeatureFlagGuard to cryptographically gate premium UI. Checked via Lit Protocol MPC — no server round-trip required.",
    code: `<FeatureFlagGuard
  featureKey="analytics"
  fallback={<UpgradePrompt />}
>
  <PremiumAnalyticsDashboard />
</FeatureFlagGuard>`,
  },
];

export function HowItWorksSection() {
  const [activeStep, setActiveStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

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

  // Auto-cycle through steps
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="relative py-32 overflow-hidden bg-secondary/30"
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="mb-20">
          <p className="text-sm font-mono text-primary mb-3">// INTEGRATION</p>
          <h2
            className={`text-3xl lg:text-5xl font-semibold tracking-tight mb-6 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
          >
            <span className="text-balance">Three steps to</span>
            <br />
            <span className="text-balance">on-chain billing.</span>
          </h2>
        </div>

        {/* Main content */}
        <div className="grid lg:grid-cols-2 gap-16 items-start">
          {/* Steps list */}
          <div className="space-y-2">
            {steps.map((step, index) => (
              <button
                key={step.number}
                type="button"
                onClick={() => setActiveStep(index)}
                className={`w-full text-left p-6 rounded-xl border transition-all duration-300 ${activeStep === index
                  ? "bg-card border-primary/50 card-shadow"
                  : "bg-transparent border-transparent hover:bg-card/50"
                  }`}
              >
                <div className="flex items-start gap-4">
                  <span
                    className={`font-mono text-sm transition-colors ${activeStep === index ? "text-primary" : "text-muted-foreground"
                      }`}
                  >
                    {step.number}
                  </span>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-1">{step.title}</h3>
                    <p
                      className={`text-sm leading-relaxed transition-colors ${activeStep === index ? "text-muted-foreground" : "text-muted-foreground/60"
                        }`}
                    >
                      {step.description}
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                {activeStep === index && (
                  <div className="mt-4 ml-8">
                    <div className="h-0.5 bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full animate-[progress_4s_linear]"
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Code display */}
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
                  app.tsx
                </span>
              </div>

              {/* Code content — light gray background */}
              <div className="p-6 font-mono text-sm min-h-[200px] bg-[#f5f5f5]">
                <pre className="text-gray-700">
                  {steps[activeStep].code.split('\n').map((line, i) => (
                    <div
                      key={`${activeStep}-${i}`}
                      className="leading-relaxed animate-in fade-in slide-in-from-left-2"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <span className="text-gray-400 select-none w-6 inline-block text-right mr-4">{i + 1}</span>
                      <span
                        dangerouslySetInnerHTML={{
                          __html: highlightCode(line)
                        }}
                      />
                    </div>
                  ))}
                </pre>
              </div>

              {/* Output — slightly darker gray */}
              <div className="border-t border-gray-200 p-4 bg-[#eaeaea] font-mono text-xs">
                <div className="flex items-center gap-2 text-blue-600">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  Ready
                </div>
              </div>
            </div>

            {/* ASCII decoration */}

          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes progress {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
    </section>
  );
}

function highlightCode(line: string): string {
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

  // 1. Strings first
  escaped = escaped.replace(/('.*?'|".*?")/g, (m) =>
    placeholder(`<span style="color:#2563eb">${m}</span>`)
  );

  // 2. Comments
  escaped = escaped.replace(/(\/\/.*$)/g, (m) =>
    placeholder(`<span style="color:#9ca3af">${m}</span>`)
  );

  // 3. Keywords
  escaped = escaped.replace(/\b(import|from|const|await|for|process)\b/g, (m) =>
    placeholder(`<span style="color:#1a1a2e;font-weight:500">${m}</span>`)
  );

  // 4. Method names
  escaped = escaped.replace(/(\.[\w]+)/g, (m) =>
    placeholder(`<span style="color:#3b3bbd">${m}</span>`)
  );

  // 5. Brackets
  escaped = escaped.replace(/(\{|\}|\(|\)|\[|\]|:)/g, (m) =>
    placeholder(`<span style="color:#6b7280">${m}</span>`)
  );

  // Restore tokens
  return escaped.replace(/\x00(\d+)\x00/g, (_, idx) => tokens[Number(idx)]);
}
