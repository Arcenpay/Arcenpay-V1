import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AcmeScan — ArcenPay SDK Demo",
  description: "Full SaaS demo showing ArcenPay feature flags, event tracking, and company management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
