"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const mockPlans = [
  {
    name: "Starter",
    price: "$12",
    description: "For founders digitizing receipts without a finance team yet.",
    features: [
      "75 AI receipt scans each month",
      "Structured merchant + tax extraction",
      "Searchable document vault",
      "ArcenPay wallet checkout",
    ],
  },
  {
    name: "Growth",
    price: "$39",
    description: "For small teams running reimbursements and close books weekly.",
    features: [
      "400 scans with usage enforcement",
      "AI receipt summaries",
      "Shared workspace visibility",
      "Priority support and exports",
    ],
    popular: true,
  },
  {
    name: "Scale",
    price: "Custom",
    description: "For operators with heavy throughput, approvals, and procurement rules.",
    features: [
      "Volume-based scan allowances",
      "Custom policies and onboarding",
      "API + workflow integration support",
      "Dedicated ArcenPay migration help",
    ],
  },
];

export function LockedPricingUI() {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        {mockPlans.map((plan, i) => (
          <Card
            key={i}
            className={`relative overflow-hidden h-full ${
              plan.popular
                ? "border-primary/60 bg-primary/[0.04] shadow-lg"
                : "border-border/60 bg-background/90 shadow-sm"
            }`}
          >
            {plan.popular && (
              <Badge className="absolute right-5 top-5 rounded-full px-3 py-1 text-xs font-medium">
                Most popular
              </Badge>
            )}
            <CardContent className="p-6 flex flex-col h-full">
              <h3 className="text-2xl font-bold">{plan.name}</h3>
              <div className="flex items-baseline mt-4">
                <span className="text-4xl font-bold">{plan.price}</span>
                {plan.price !== "Custom" && (
                  <span className="text-muted-foreground ml-1">/month</span>
                )}
              </div>
              <p className="text-muted-foreground mt-2">{plan.description}</p>
              <ul className="space-y-3 my-6 flex-grow">
                {plan.features.map((feature, j) => (
                  <li key={j} className="flex items-center">
                    <Check className="mr-2 size-4 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className={`mt-auto w-full rounded-full ${
                  plan.popular
                    ? "bg-primary hover:bg-primary/90"
                    : "bg-muted hover:bg-muted/80"
                }`}
                variant={plan.popular ? "default" : "outline"}
              >
                <Link href="/plans">
                  Open billing
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.45, delay: 0.15 }}
        className="mt-8 flex flex-col items-center gap-3 rounded-3xl border border-border/60 bg-background/80 px-6 py-8 text-center shadow-sm"
      >
        <p className="max-w-2xl text-sm text-muted-foreground">
          Plans are purchased and enforced through ArcenPay. The live billing
          workspace opens on the next screen after sign-in and wallet connect.
        </p>
        <Button asChild size="lg" className="rounded-full px-8">
          <Link href="/plans">
            Manage plans with ArcenPay
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </motion.div>
    </div>
  );
}
