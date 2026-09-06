# StellarAI Demo dApp

A minimal SaaS demo built with **Vite + React + TypeScript** that integrates the **ArcenPay React SDK** for Web3 subscription billing on **Stellar testnet**.

## What This Demo Shows

1. **ArcenPayProvider** — Wraps the app with your publishable key and component ID.
2. **Freighter Wallet** — Connects a Stellar wallet (Freighter browser extension).
3. **Feature Gating** — Uses `useFlag('aifetures')` to lock/unlock the AI Image Generator based on the user's plan.
4. **Entitlements Grid** — Displays all resolved entitlements from `useCompanyEntitlements()`.
5. **ArcenEmbed** — Embeds the full billing UI (plan manager, invoices, payment methods) directly in the app.
6. **Identify Flow** — Auto-creates a company record in ArcenPay when the wallet connects.

## Configuration

Hardcoded credentials (for demo purposes only):

| Key | Value |
|-----|-------|
| `publishableKey` | `api__bM8SiVSGe6UcNRcOrYN-iEyJjBU_ypMvvOkN_ruNdY` |
| `componentId` | `cmsdjtw440004zrv0hvifafj6` |
| `wallet` | `GAZPERPGPI5EVC46B2VFBXJE4EFCSYBJVW2K7IASW3EZECRHOKSQC3TT` |

## Features Available in Your Account

From the backend lookup, your Stellar wallet has access to:

- **`free`** — Boolean feature (enabled on the **Free** plan)
- **`aifetures`** — Boolean feature (enabled on the **Starter** plan, $6/month)

You are currently on the **Free** plan, so `aifetures` is **disabled**. The demo UI shows a locked state for the AI Image Generator and an "Upgrade to Starter" CTA that scrolls to the billing section.

## Running Locally

```bash
# From repo root
npm run dev:demo

# Or directly
cd apps/demo-dapp
npm run dev
```

The app will be available at **http://localhost:5173** (or the next free port if 5173 is taken).

## Building

```bash
cd apps/demo-dapp
npm run build
```

Output goes to `dist/`.

## File Structure

```
src/
├── main.tsx      # React root
├── App.tsx       # ArcenPayProvider setup
├── Dashboard.tsx # Full demo UI (wallet, features, embed)
└── index.css     # Minimal CSS reset
```

## Tech Stack

- Vite 5 + React 19 + TypeScript (strict)
- `@arcenpay/react` — Billing SDK
- `@stellar/freighter-api` — Stellar wallet connection

## Troubleshooting

### "Identify error: Invalid wallet address format"

This means the backend is rejecting your Stellar `G...` address. The backend validation was fixed to accept any wallet format (EVM + Stellar). Make sure your backend is restarted after pulling the latest changes.

### ArcenEmbed not showing

The `ArcenEmbed` component from `@arcenpay/react` renders inside the **Billing & Plans** section at the bottom of the page. It only appears after:
1. Wallet is connected
2. `identify()` succeeds (session token created)

Before that, you'll see a placeholder with a "Connect Wallet to Load Billing" button.

### Wallet shows "connected" without clicking

Freighter remembers authorization. If you previously allowed this site, it auto-connects. Click the **✕** next to the wallet badge to clear local state, or revoke the site in Freighter settings.

## Notes

- The demo uses **Stellar testnet** (chainId `9000001`).
- The `ArcenEmbed` component will show "coming soon" messages for Stellar on-chain actions (activation, plan changes) until backend support is fully wired.
- The AI Image Generator is a **mock** — in production you would integrate with an actual image generation API and call `consume()` to deduct metered credits.
