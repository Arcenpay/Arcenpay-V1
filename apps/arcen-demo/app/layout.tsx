import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AcmeScan — ArcenPay SDK Demo",
  description:
    "Full SaaS demo showing ArcenPay SDK: feature flags, subscriptions, usage tracking, and on-chain billing",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
