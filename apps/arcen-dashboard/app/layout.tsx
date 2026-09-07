import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { DashboardStructuredData } from "@/components/seo/dashboard-structured-data";
import { Web3Provider } from "@/components/providers/web3-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { BACKEND_URL } from "@/lib/config";
import { rootMetadata } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = rootMetadata;
const browserBackendUrl = JSON.stringify(
  BACKEND_URL.replace(/\/$/, ""),
).replace(/</g, "\\u003c");

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
                var backendOrigin = ${browserBackendUrl};
                var originalFetch = window.fetch.bind(window);

                window.fetch = function(input, init) {
                  var requestUrl = typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
                  var parsedUrl = new URL(requestUrl, window.location.origin);
                  var isDashboardApi =
                    parsedUrl.origin === window.location.origin &&
                    parsedUrl.pathname.startsWith('/api/') &&
                    parsedUrl.pathname !== '/api/health';

                  if (!isDashboardApi) {
                    return originalFetch(input, init);
                  }

                  if (!parsedUrl.pathname.startsWith('/api/v1/')) {
                    parsedUrl.pathname = parsedUrl.pathname.replace(
                      /^\/api\//,
                      '/api/v1/',
                    );
                  }

                  var nextInit = Object.assign({}, init || {}, {
                    credentials: (init && init.credentials) || 'include',
                    mode: 'cors',
                  });
                  var nextInput = input instanceof Request
                    ? new Request(parsedUrl.toString(), input)
                    : parsedUrl.toString();

                  return originalFetch(nextInput, nextInit);
                };
              })();
            `,
          }}
        />
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
