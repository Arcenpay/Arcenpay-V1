"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { ReactNode } from "react";

export function AnimatedHeader() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center space-y-4 text-center mb-12"
    >
      <Badge
        className="rounded-full px-4 py-1.5 text-sm font-medium"
        variant="secondary"
      >
        Pricing
      </Badge>
      <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
        Choose Your Perfect Plan
      </h2>
      <p className="max-w-[800px] text-muted-foreground md:text-lg">
        Scale with your needs. Start free and upgrade as you grow. All plans
        include AI-powered features.
      </p>
    </motion.div>
  );
}

export function AnimatedPricingWrapper({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="mx-auto max-w-5xl"
    >
      {children}
    </motion.div>
  );
}
