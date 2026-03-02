import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArcenPay — The Web3 Billing Layer",
  description:
    "Recurring subscription billing and AI agent metered billing for Web3. MEAP + ZKVUB protocol.",
  openGraph: {
    title: "ArcenPay — The Web3 Billing Layer",
    description: "Recurring subscriptions + zk-metered AI billing on Ethereum.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
