"use client";

import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApolloProvider } from "@apollo/client";
import { Toaster } from "sonner";
import { wagmiConfig } from "@/lib/wagmi";
import { apolloClient } from "@/lib/graphql";

import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

export function Web3Provider({ children }: { children: React.ReactNode }) {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <ApolloProvider client={apolloClient}>
                    <RainbowKitProvider
                        theme={lightTheme({
                            accentColor: "#0000ff",
                            accentColorForeground: "white",
                            borderRadius: "medium",
                            fontStack: "system",
                        })}
                        modalSize="compact"
                    >
                        {children}
                        <Toaster richColors position="bottom-right" />
                    </RainbowKitProvider>
                </ApolloProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
