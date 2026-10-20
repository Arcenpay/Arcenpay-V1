"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { GA_MEASUREMENT_ID } from "@/lib/analytics";

export function GoogleAnalytics() {
  const pathname = usePathname();
  // GA's `config` call records the landing page view. Only subsequent client-side
  // navigations need a manual hit — firing on mount as well would double-count.
  const initialPath = useRef(pathname);

  useEffect(() => {
    if (pathname === initialPath.current) return;

    const payload = {
      page_path: pathname,
      page_location: `${window.location.origin}${pathname}`,
      page_title: document.title,
    };

    // gtag.js may still be loading (afterInteractive); queue the command on the
    // dataLayer instead of dropping the navigation entirely.
    if (typeof window.gtag === "function") {
      window.gtag("event", "page_view", payload);
      return;
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(["event", "page_view", payload]);
  }, [pathname]);

  if (!GA_MEASUREMENT_ID) return null;

  return (
    <>
      <Script
        id="ga-library"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', {
            anonymize_ip: true,
            send_page_view: true
          });
        `}
      </Script>
    </>
  );
}
