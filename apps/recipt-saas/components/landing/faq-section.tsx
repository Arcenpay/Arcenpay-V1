"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "How does AI-powered receipt scanning work?",
    answer:
      "Our advanced OCR and AI technology instantly extracts all relevant information from your receipts including merchant name, date, amount, items, tax, and payment method. The AI learns over time to improve accuracy and automatically categorizes your expenses.",
  },
  {
    question: "What file formats are supported?",
    answer:
      "We support all common image formats (JPG, PNG, HEIC) and PDF files. You can upload receipts from your phone camera, scanner, or email. Our AI can process receipts of any quality, even faded or crumpled ones.",
  },
  {
    question: "How many receipts can I scan per month?",
    answer:
      "The number of scans depends on your plan. Starter plans include 100 scans per month, Professional plans offer 500 scans, and Enterprise plans provide unlimited scanning. Unused scans don't roll over to the next month.",
  },
  {
    question: "Can I export my receipt data?",
    answer:
      "Yes! You can export your data in multiple formats including CSV, Excel, PDF reports, and integrate with popular accounting software like QuickBooks and Xero. All plans include unlimited exports.",
  },
  {
    question: "How secure is my receipt data?",
    answer:
      "Your data security is our top priority. All receipts are encrypted in transit and at rest using bank-level encryption. We're GDPR and SOC 2 compliant. You can delete your data anytime, and we never share your information with third parties.",
  },
  {
    question: "What makes the AI summaries useful?",
    answer:
      "Our AI analyzes your spending patterns and generates insights like top spending categories, unusual transactions, budget alerts, and monthly trends. It helps you understand where your money goes and identifies opportunities to save.",
  },
];

export function FaqSection() {
  return (
    <section
      id="faq"
      className="w-full py-20 md:py-32 flex justify-center items-center"
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
            FAQ
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Frequently Asked Questions
          </h2>
          <p className="max-w-[800px] text-muted-foreground md:text-lg">
            Everything you need to know about Receipt and AI-powered expense
            management.
          </p>
        </motion.div>

        <div className="mx-auto max-w-3xl">
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
              >
                <AccordionItem
                  value={`item-${i}`}
                  className="border-b border-border/40 py-2"
                >
                  <AccordionTrigger className="text-left font-medium hover:no-underline">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              </motion.div>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
