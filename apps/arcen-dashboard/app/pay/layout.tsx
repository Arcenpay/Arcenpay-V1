import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Hosted Checkout",
  description: "Complete a hosted ArcenPay checkout securely.",
  path: "/pay",
  noIndex: true,
});

export default function PayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
