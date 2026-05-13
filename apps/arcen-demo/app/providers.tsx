"use client";

import type { ReactNode } from "react";
import { ArcenPayProvider } from "@arcenpay/react";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ArcenPayProvider
      componentId={process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID}
      publishableKey={process.env.NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY}
      walletConnectProjectId={process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
    >
      <RainbowKitProvider
        theme={darkTheme({
          accentColor: "#6366f1",
          borderRadius: "small",
        })}
        modalSize="compact"
      >
        {children}
      </RainbowKitProvider>
    </ArcenPayProvider>
  );
}
