# @arcenpay/dashboard

The ArcenPay provider control plane — a **Next.js 16 App Router** application where
providers configure plans, manage subscriptions, build invoices, and monitor billing.

## Stack

| Concern | Technology |
| :--- | :--- |
| Framework | Next.js 16 (App Router, React 19) |
| Styling | Tailwind CSS v4 + shadcn/ui primitives |
| Wallets | wagmi + Reown AppKit, Freighter, Solana wallet adapter |
| Data | TanStack Query + Apollo Client |
| Charts | Recharts |
| Observability | Sentry |

## Scripts

```bash
npm run dev --workspace=@arcenpay/dashboard        # next dev on :3000
npm run build --workspace=@arcenpay/dashboard      # next build
npm run test --workspace=@arcenpay/dashboard       # vitest
npm run test:e2e --workspace=@arcenpay/dashboard   # playwright
npm run typecheck --workspace=@arcenpay/dashboard
```

## Environment

Copy the repository root `.env.example` to `.env`. Production values are documented
in `apps/arcen-dashboard/.env.example` and `.env.production.example`.

## Layout

```
app/            # App Router routes (dashboard, onboarding, pay, admin, …)
hooks/          # Client hooks
contexts/       # React context providers
types/          # Local type declarations
tests/e2e/      # Playwright end-to-end specs
```
