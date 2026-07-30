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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var root = document.documentElement;
                  var stored = localStorage.getItem('theme');
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
                    localStorage.setItem('theme', 'system');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
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
