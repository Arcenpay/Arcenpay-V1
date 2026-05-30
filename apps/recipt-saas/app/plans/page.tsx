import { InlineBilling } from "@/components/arcen/inline-billing";

export default function PlansPage() {
  return (
    <main className="flex-1 bg-[radial-gradient(circle_at_top,rgba(15,118,110,0.08),transparent_48%),linear-gradient(180deg,rgba(15,23,42,0.02),transparent_35%)]">
      <div className="container mx-auto max-w-6xl px-4 py-12 md:px-6 md:py-20">
        <div className="mb-10 max-w-3xl space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">
            ArcenPay Billing
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
            Manage plans, wallet access, and receipt-scan usage in one place.
          </h1>
          <p className="text-lg text-muted-foreground">
            This workspace now uses ArcenPay for checkout, subscription
            ownership, and metered scan enforcement. Sign in, connect the
            billing wallet, and choose the plan that matches your volume.
          </p>
        </div>

        <InlineBilling initialView="portal" />
      </div>
    </main>
  );
}
