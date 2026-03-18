# ArcenPay Testnet Integration Credentials Checklist

Use this checklist to fully wire dashboard + facilitator + external services on testnet.

## 1) Core Infra (required)

- `DATABASE_URL` (Postgres for dashboard)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- `SIWE_JWT_SECRET`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `FACILITATOR_SECRET` (same value in dashboard and facilitator)

## 2) Testnet Chain Access (required)

- Sepolia RPC: `RPC_URL_11155111` (dashboard), `RPC_URL` + `CHAIN_ID=11155111` (facilitator)
- Optional Base Sepolia RPC: `RPC_URL_84532`
- Deployer key with test ETH:
  - `DEPLOYER_PRIVATE_KEY` (dashboard contract registration routes)
  - `PRIVATE_KEY` (facilitator settlement/keeper)

### Optional test token override

- `NEXT_PUBLIC_USDC_ADDRESS_11155111` (use your mock USDC on Sepolia)
- `NEXT_PUBLIC_USDC_ADDRESS_84532` (use your mock USDC on Base Sepolia)

## 3) Indexing + Analytics (required for full dashboard data)

- Subgraph URL(s):
  - `NEXT_PUBLIC_GRAPH_URL_11155111`
  - optional `NEXT_PUBLIC_GRAPH_URL_84532`

## 4) Paymaster / ZeroDev (required for sponsorship)

- `PAYMASTER_RPC_URL` (or legacy `ZERODEV_PAYMASTER_RPC`)
- `PAYMASTER_CHAIN_IDS` (testnet only, example `84532`)
- Optional if provider requires auth: `PAYMASTER_RPC_AUTH_TOKEN`

## 5) Notifications (recommended)

- `RESEND_API_KEY`
- `EMAIL_FROM`
- Optional outbound webhook:
  - `WEBHOOK_URL`
  - `WEBHOOK_SIGNING_SECRET`

## 6) Optional Integrations

- Tableland:
  - `TABLELAND_TABLE_NAME`
  - `TABLELAND_PRIVATE_KEY`
  - optional `TABLELAND_RPC_URL`, `TABLELAND_GATEWAY_URL`
- Lit:
  - `LIT_NETWORK`
- Axelar:
  - `AXELAR_GATEWAY_ADDRESS`
  - `AXELAR_GAS_SERVICE_ADDRESS`
- CCIP:
  - `CCIP_ROUTER_ADDRESS`
  - optional `CCIP_LINK_TOKEN_ADDRESS`

## 7) Mock USDC deployment requirements

To deploy and mint test `mUSDC` to any wallet:

- `DEPLOYER_PRIVATE_KEY` funded with Sepolia/Base Sepolia ETH
- RPC configured for chosen testnet in `packages/contracts` context:
  - `SEPOLIA_RPC_URL` or `BASE_SEPOLIA_RPC_URL`
- recipient address
- mint amount

Script added:

- `npm --prefix packages/contracts run deploy:mock-usdc:sepolia`
- `npm --prefix packages/contracts run deploy:mock-usdc:base-sepolia`

Required env for script run:

- `MOCK_USDC_RECIPIENT=0x...`
- `MOCK_USDC_MINT_AMOUNT=10000`
