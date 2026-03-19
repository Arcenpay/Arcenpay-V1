import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { Web3Provider } from "@/components/providers/web3-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArcenPay Dashboard",
  description:
    "ArcenPay Provider Dashboard — Subscription Management & Protocol Analytics",
  generator: "v0.app",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersObj = await headers();
  const cookies = headersObj.get("cookie");

  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      <html lang="en">
        <body className={`font-sans antialiased`}>
          <Web3Provider cookies={cookies}>{children}</Web3Provider>
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
