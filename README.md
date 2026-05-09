# ArcenPay

ArcenPay is a monorepo for dashboard-managed billing, embedded customer billing surfaces, hosted payment links, entitlement-aware product access, and optional x402-style agent payments.

## What ships here

- `apps/arcen-dashboard`: provider control plane for plans, add-ons, credits, companies, components, invoices, payments, flags, and webhooks.
- `apps/arcen-demo`: demo app showing the public React and Node SDK surface.
- `apps/docs`: the developer documentation site.
- `apps/facilitator`: runtime bridge for renewals, webhook fan-out, event processing, and advanced protocol flows.
- `packages/sdk-react`: browser SDK with `ArcenPayProvider`, `ArcenEmbed`, hooks, and payment-link helpers.
- `packages/sdk-node`: server SDK with `ArcenClient`, webhook verification, activation, and advanced runtime services.
- `packages/sdk-agent`: autonomous payment SDK for bots and agent workloads.
- `packages/internal-core`: private shared source used to build internal runtime helpers.
- `packages/contracts`, `subgraph`, `circuits`: contract, indexing, and proof-related infrastructure.

## Quick start

Prerequisites:

- Node.js 20+
- npm 10+
- Docker

Setup:

```bash
cp .env.example .env
npm ci
docker compose up -d
npm run build
```

Run the main apps:

```bash
npm run dev:dashboard   # http://localhost:3000
npm run dev:demo        # http://localhost:3001
npm run dev:docs        # http://localhost:3003
npm run dev:facilitator
```

## Core commands

| Command             | Purpose                               |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Run workspace dev tasks through Turbo |
| `npm run build`     | Build packages and apps               |
| `npm run test`      | Run workspace tests                   |
| `npm run typecheck` | Run TypeScript checks                 |
| `npm run lint`      | Run workspace lint tasks              |
| `npm run clean`     | Remove build outputs                  |
| `npm run format`    | Format source files                   |

## Main integration path

The standard product integration path today is:

1. Configure plans, components, payment links, and webhooks in `apps/arcen-dashboard`.
2. Use `@arcenpay/react` in the browser for `ArcenPayProvider`, `identify()`, and `ArcenEmbed`.
3. Use `@arcenpay/node` on the server for access checks, access tokens, company APIs, subscription activation, and webhook verification.
4. Use `@arcenpay/agent` only if you need autonomous x402-style payments for bots or agents.

## Docs

- Public docs source: `apps/docs`
- Demo integration source: `apps/arcen-demo`
- SDK READMEs:
  - `packages/sdk-react/README.md`
  - `packages/sdk-node/README.md`
  - `packages/sdk-agent/README.md`

## License

Proprietary — all rights reserved.
