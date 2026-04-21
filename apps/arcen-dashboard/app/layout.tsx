import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { Web3Provider } from "@/components/providers/web3-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArcenPay Dashboard",
  description:
    "ArcenPay Provider Dashboard — Subscription Management & Protocol Analytics",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersObj = await headers();
  const cookies = headersObj.get("cookie");

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Web3Provider cookies={cookies}>{children}</Web3Provider>
        <Analytics />
      </body>
    </html>
  );
}
