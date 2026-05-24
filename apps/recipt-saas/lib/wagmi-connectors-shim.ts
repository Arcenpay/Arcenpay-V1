// ArcenPay imports wagmi's connector barrel, which currently brings in
// connectors we do not support in this app. Re-export only the connectors
// that match our Clerk + MetaMask + WalletConnect setup.
export { walletConnect } from "@wagmi/connectors";
export { metaMask as injected } from "@wagmi/connectors";
