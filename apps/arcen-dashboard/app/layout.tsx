import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";
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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var root = document.documentElement;
                  // Use a namespaced key so stale theme values from the old
                  // dashboard implementation cannot force the wrong mode.
                  var stored = localStorage.getItem('arcenpay-theme');
                  if (stored === 'dark') {
                    root.classList.add('dark');
                  } else if (stored === 'light') {
                    root.classList.remove('dark');
                  } else {
                    // Default to system preference
                    var m = window.matchMedia('(prefers-color-scheme: dark)');
                    if (m.matches) {
                      root.classList.add('dark');
                    } else {
                      root.classList.remove('dark');
                    }
                    localStorage.setItem('arcenpay-theme', 'system');
                  }
                } catch (e) {
                  // Fallback to system preference if localStorage is unavailable
                  var m = window.matchMedia('(prefers-color-scheme: dark)');
                  if (m.matches) {
                    root.classList.add('dark');
                  } else {
                    root.classList.remove('dark');
                  }
                }
              })();
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <DashboardStructuredData />
        <GoogleAnalytics />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="arcenpay-theme"
          disableTransitionOnChange
        >
          <Web3Provider cookies={cookies}>{children}</Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
