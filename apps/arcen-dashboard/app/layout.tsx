import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { DashboardStructuredData } from "@/components/seo/dashboard-structured-data";
import { Web3Provider } from "@/components/providers/web3-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { rootMetadata } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = rootMetadata;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersObj = await headers();
  const cookies = headersObj.get("cookie");

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <DashboardStructuredData />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Web3Provider cookies={cookies}>{children}</Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
