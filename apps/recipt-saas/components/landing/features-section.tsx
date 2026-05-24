"use client";

import { motion } from "framer-motion";
import { Scan, Brain, PieChart, Download, Search, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    title: "AI-Powered Scanning",
    description:
      "Instantly scan and digitize receipts with advanced OCR technology. Capture every detail accurately.",
    icon: <Scan className="size-5" />,
  },
  {
    title: "Smart Categorization",
    description:
      "Automatically categorize expenses with AI. No manual sorting needed - our AI learns your spending patterns.",
    icon: <Brain className="size-5" />,
  },
  {
    title: "Intelligent Analytics",
    description:
      "Get AI-generated summaries and insights about your spending. Understand where your money goes.",
    icon: <PieChart className="size-5" />,
  },
  {
    title: "Instant Export",
    description:
      "Export your data in multiple formats. Generate expense reports in seconds for accounting or taxes.",
    icon: <Download className="size-5" />,
  },
  {
    title: "Smart Search",
    description:
      "Find any receipt instantly with powerful AI search. Search by merchant, amount, date, or category.",
    icon: <Search className="size-5" />,
  },
  {
    title: "Real-time Processing",
    description:
      "Lightning-fast processing with cloud AI. Get results immediately, no waiting around.",
    icon: <Zap className="size-5" />,
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="w-full py-20 md:py-32 flex justify-center"
    >
      <div className="container px-4 md:px-6">
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
            Powerful Features
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Everything You Need for Smart Expense Management
          </h2>
          <p className="max-w-[800px] text-muted-foreground md:text-lg">
            From AI-powered scanning to intelligent insights, Receipt provides
            all the tools you need to effortlessly manage receipts and track
            expenses.
          </p>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((feature, i) => (
            <motion.div key={i} variants={item}>
              <Card className="h-full overflow-hidden border-border/40 bg-gradient-to-b from-background to-muted/10 backdrop-blur transition-all hover:shadow-md">
                <CardContent className="p-6 flex flex-col h-full">
                  <div className="size-10 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center text-primary mb-4">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
