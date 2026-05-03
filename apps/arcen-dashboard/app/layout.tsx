import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Web3Provider } from "@/components/providers/web3-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArcenPay Dashboard",
  description:
    "ArcenPay Provider Dashboard — Subscription Management & Protocol Analytics",
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
      </body>
    </html>
  );
}
