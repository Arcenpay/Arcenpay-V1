# ArcenPay Testnet Integration Credentials Checklist

Use this checklist to fully wire dashboard + facilitator + external services for a Base Sepolia launch.

## 1) Core Infra (required)

- `DATABASE_URL` (Postgres for dashboard)
- `SIWE_JWT_SECRET`
- `ACCESS_TOKEN_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_ZERODEV_PROJECT_ID` if you want to re-enable portal-based on-chain plan changes or cancellation
- `FACILITATOR_SECRET` (same value in dashboard and facilitator)
- Launch-safe portal defaults:
  - `ARCENPAY_ENABLE_SELF_SERVE_PLAN_CHANGES=false`
  - `ARCENPAY_ENABLE_SELF_SERVE_CANCELLATION=false`
  - `ARCENPAY_REQUIRE_SUBGRAPH=false`
  - `NEXT_PUBLIC_ARCENPAY_ENABLE_PORTAL_PLAN_CHANGES=false`
  - `NEXT_PUBLIC_ARCENPAY_ENABLE_PORTAL_CANCELLATION=false`
  - `NEXT_PUBLIC_ARCENPAY_REQUIRE_SUBGRAPH=false`

## 2) Testnet Chain Access (required)

- Base Sepolia defaults:
  - `NEXT_PUBLIC_CHAIN_ID=84532`
  - `MEAP_DEFAULT_CHAIN_ID=84532`
  - `CHAIN_ID=84532`
  - `RPC_URL_84532`
  - `RPC_URL=${RPC_URL_84532}` for facilitator/runtime helpers
- Optional Sepolia fallback:
  - `RPC_URL_11155111`
- Signer keys with Base Sepolia ETH:
  - `DEPLOYER_PRIVATE_KEY` for deploy scripts
  - `PRIVATE_KEY` for facilitator settlement/keeper
  - `ONCHAIN_PROVIDER_PRIVATE_KEY` or `SUBSCRIPTION_BILLER_PRIVATE_KEY` for plan registration + activation

### Optional test token override

- `NEXT_PUBLIC_USDC_ADDRESS_11155111` (use your mock USDC on Sepolia)
- `NEXT_PUBLIC_USDC_ADDRESS_84532` (use your mock USDC on Base Sepolia)

## 3) Indexing + Analytics (optional for MVP, required for full dashboard data)

- Subgraph URL(s):
  - `NEXT_PUBLIC_GRAPH_URL_84532`
  - optional `NEXT_PUBLIC_GRAPH_URL_11155111`
  - optional `MEAP_SUBGRAPH_URL_84532`

## 4) Contract Registry (required)

- Base Sepolia contract addresses:
  - `ARCENPAY_CONTRACT_84532_planFactory`
  - `ARCENPAY_CONTRACT_84532_subscriptionRegistry`
  - `ARCENPAY_CONTRACT_84532_autopayModule`
  - `ARCENPAY_CONTRACT_84532_feeCollector`
  - `ARCENPAY_CONTRACT_84532_sessionVault`
  - `ARCENPAY_CONTRACT_84532_zkUsageVerifier`
  - optional `ARCENPAY_CONTRACT_84532_mirrorRegistry`

## 5) Paymaster / ZeroDev (required for sponsorship)

- `PAYMASTER_RPC_URL` (or legacy `ZERODEV_PAYMASTER_RPC`)
- `PAYMASTER_CHAIN_IDS` (testnet only, example `84532`)
- Optional if provider requires auth: `PAYMASTER_RPC_AUTH_TOKEN`

Recommended format (v3):
- `PAYMASTER_RPC_URL=https://rpc.zerodev.app/api/v3/<PROJECT_ID>/chain/84532`

## 6) Notifications (recommended)

- `RESEND_API_KEY`
- `EMAIL_FROM`
- Optional outbound webhook:
  - `WEBHOOK_URL`
  - `WEBHOOK_SIGNING_SECRET`

## 7) Optional Integrations

- Tableland:
  - `TABLELAND_TABLE_NAME`
  - `TABLELAND_PRIVATE_KEY`
  - optional `TABLELAND_RPC_URL`, `TABLELAND_GATEWAY_URL`
  - If Tableland is unavailable, facilitator automatically falls back to in-memory feature flags (development-safe fallback)
- Lit:
  - `LIT_NETWORK`
- Axelar:
  - `AXELAR_GATEWAY_ADDRESS`
  - `AXELAR_GAS_SERVICE_ADDRESS`
- CCIP:
  - `CCIP_ROUTER_ADDRESS`
  - optional `CCIP_LINK_TOKEN_ADDRESS`

## 8) Smart Ownership (required for first on-chain provider registration)

- Set `PLAN_FACTORY_OWNER_ADDRESS` to your Safe/multisig owner address.
- For the fastest testnet launch, either:
  - set `PLAN_FACTORY_OWNER_PRIVATE_KEY` temporarily in a private backend env, or
  - keep it empty and execute the returned `ownerActionRequired` payload from your Safe/multisig.
- Use PlanFactory owner as a Safe/multisig.
- When relayer provider registration is needed, execute `registerProvider(relayer)` from owner Safe.
- Dashboard API now returns calldata (`ownerActionRequired`) for Safe transaction execution.

## 9) Mock USDC deployment requirements

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
