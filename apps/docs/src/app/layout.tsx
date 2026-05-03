import type { Metadata } from "next";
import "./globals.css";
import DocsShell from "./DocsShell";
import { ThemeProvider } from "@/hooks/use-theme";

export const metadata: Metadata = {
  title: {
    default: "ArcenPay Docs",
    template: "%s - ArcenPay Docs",
  },
  description:
    "Developer documentation for integrating ArcenPay subscriptions, hosted Base Sepolia USDC payments, invoice collection, and SDKs.",
  keywords: [
    "ArcenPay",
    "crypto payments",
    "USDC payments",
    "Base Sepolia",
    "subscriptions",
    "web3 billing",
    "blockchain payments",
    "smart account",
    "ERC-4337",
  ],
  authors: [{ name: "ArcenPay" }],
  creator: "ArcenPay",
  publisher: "ArcenPay",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.arcenpay.xyz",
  ),
  openGraph: {
    type: "website",
    siteName: "ArcenPay Docs",
    title: "ArcenPay Docs",
    description:
      "Developer documentation for integrating ArcenPay subscriptions, hosted payments, invoices, and SDKs.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "ArcenPay Docs",
    description:
      "Developer documentation for integrating ArcenPay subscriptions, hosted payments, invoices, and SDKs.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=DM+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThemeProvider>
          <DocsShell>{children}</DocsShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
