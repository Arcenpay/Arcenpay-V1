const STEPS = [
  {
    num: "01",
    title: "Create a Plan",
    desc: "Call PlanFactory.createPlan() with price, billing interval, and accepted token. A plan ID is minted on-chain and indexed by The Graph.",
    code: `await writeContract({
  address: PLAN_FACTORY,
  abi: PlanFactoryABI,
  functionName: "createPlan",
  args: [name, tier, price, interval, USDC, ""],
});`,
  },
  {
    num: "02",
    title: "Subscriber Onboards",
    desc: "The CheckoutModal deploys an ERC-4337 smart account via ZeroDev, installs the ERC-7579AutopayModule, and mints a subscription NFT.",
    code: `import { CheckoutModal } from "@meap/react";

<CheckoutModal
  planId={1n}
  onSuccess={(result) => console.log(result)}
/>`,
  },
  {
    num: "03",
    title: "Autopay Runs Automatically",
    desc: "The keeper service calls ERC7579AutopayModule.execute() on schedule. Subscribers never need to manually renew.",
    code: `// Keeper triggers billing automatically
// when canExecute() returns true
const canBill = await readContract({
  functionName: "canExecute",
  args: [subscriberSmartAccount],
});`,
  },
];

export function HowItWorks() {
  return (
    <section className="py-24 px-6 bg-zinc-950/50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">How It Works</h2>
          <p className="text-zinc-400 text-lg">
            From plan creation to automatic recurring billing in three steps.
          </p>
        </div>

        <div className="space-y-8">
          {STEPS.map((step, i) => (
            <div
              key={step.num}
              className="grid md:grid-cols-2 gap-8 items-center"
              style={{ flexDirection: i % 2 === 1 ? "row-reverse" : "row" }}
            >
              <div className={i % 2 === 1 ? "md:order-2" : ""}>
                <div className="text-5xl font-bold text-blue-500/20 mb-3">{step.num}</div>
                <h3 className="text-2xl font-bold text-white mb-3">{step.title}</h3>
                <p className="text-zinc-400 leading-relaxed">{step.desc}</p>
              </div>
              <div className={i % 2 === 1 ? "md:order-1" : ""}>
                <pre className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-sm text-zinc-300 overflow-x-auto">
                  <code>{step.code}</code>
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
