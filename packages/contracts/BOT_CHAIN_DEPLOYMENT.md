# BOT Chain Deployment Runbook

> **Status: completed for BOT Chain Mainnet (`677`).** The UUPS contracts were
> deployed on 2026-09-05 (`deployments/botMainnet-latest.json`) and their code is
> live on-chain. This runbook is retained for redeploys and upgrades.
> **BOT Chain Testnet (`968`) is still a placeholder** — the addresses in
> `deployments/botTestnet-latest.json` are deterministic stand-ins, not a
> deployment.

Everything code-side is wired and validated. This is the exact sequence to run
**yourself** (you hold the deployer private key — I never touch it). Follow it
in order: testnet first, always.

## 0. One-time setup

In the repo root `.env` (already updated with defaults):
```
DEPLOYER_PRIVATE_KEY=<your key — already present for other chains, reused automatically>
BOT_TESTNET_RPC_URL=https://rpc.bohr.life          # already set
BOT_MAINNET_RPC_URL=https://rpc.botchain.ai        # already set — see step 3 warning
```

Fund your deployer address with testnet BOT (for step 1) and, later, real BOT
(for step 3) to cover gas.

## 1. Deploy to BOT Chain Testnet (chainId 968) — do this first

```bash
cd packages/contracts
npx hardhat run scripts/deploy.ts --network botTestnet
```

This deploys the same 7 contracts you already run on every other EVM chain
(`PlanFactory`, `FeeCollector`, `SubscriptionRegistry`, `SessionVault`,
`ZKUsageVerifier`, `ERC7579AutopayModule`, `MirrorRegistry`) as UUPS proxies,
wires the roles between them, and initializes `PlanFactory` with the official
bridged USDT address (`0x75edC9335175Fc0552D51D48439F229c10420fe3`) as the
funding token.

**Output:** `packages/contracts/deployments/botTestnet-<date>.json` and
`botTestnet-latest.json` — the exact JSON file with every contract + proxy +
implementation address, deployer, and timestamp, in the same format as your
existing `arcTestnet-latest.json` etc.

## 2. Verify the testnet deployment

```bash
npx hardhat run scripts/smoke.ts --network botTestnet
```

This asserts contract code actually exists at every address in
`botTestnet-latest.json` (catches a bad RPC or partial deploy immediately).

Optionally verify contracts on the explorer (Blockscout-based, `scan.botchain.ai`):
```bash
npx hardhat verify --network botTestnet <address>
```

## 3. ⚠️ Before touching Mainnet — resolve the RPC blocker

BOT Chain's own docs state `eth_getLogs` is **disabled** on the default
public Mainnet RPC (`https://rpc.botchain.ai`). That default is fine for the
one-off deploy transactions below, but it will silently break the
facilitator's event listener in production. Before running step 4 for real
usage (not just deployment), update `BOT_MAINNET_RPC_URL` in `.env` (and
`RPC_URL_677` / `RPC_URL` in whatever facilitator env file you use — see
`apps/facilitator/.env.bot-testnet.example`) to a getLogs-capable provider.

## 4. Deploy to BOT Chain Mainnet (chainId 677) — only after 1–3 are done

```bash
npx hardhat run scripts/deploy.ts --network botMainnet
npx hardhat run scripts/smoke.ts --network botMainnet
```

**Output:** `deployments/botMainnet-<date>.json` and `botMainnet-latest.json`,
funded with the official bridged USDT
(`0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C`).

## 5. Wire the deployed addresses back into the app

Once you have `botTestnet-latest.json` / `botMainnet-latest.json`, either:

- **Hand me the JSON file(s) and I'll do the rest** — I'll replace the
  zero-address placeholders in `packages/internal-core/src/addresses.ts`
  (`ADDRESSES[968]` / `ADDRESSES[677]`) with the real values, re-sync the
  SDKs, and re-typecheck everything. This is a 2-minute mechanical step.
- **Or set the env overrides yourself** — every address supports a runtime
  override via `ARCENPAY_CONTRACT_968_<key>` / `ARCENPAY_CONTRACT_677_<key>`
  (already stubbed as commented-out lines at the bottom of the root `.env`).

Also run, for the record:
```bash
npx hardhat run scripts/export-environment-manifest.ts --network botTestnet
```
This regenerates `deployments/environment-manifest.json` including the new
chains, matching the existing multi-chain manifest format.

## 6. Stand up the facilitator for this chain

One facilitator **process** per chain — this does not replace or touch your
existing Arc Testnet facilitator.

```bash
cd apps/facilitator
cp .env.bot-testnet.example .env.bot-testnet
# fill in PRIVATE_KEY (facilitator signer — NOT the deployer key) and the
# ARCENPAY_CONTRACT_968_* addresses from step 5
FACILITATOR_ENV_FILE=.env.bot-testnet npm run dev
```

Confirm in the logs that it starts an `EvmChainAdapter` for chainId 968 and
that `EventListener` polling picks up a test subscription mint before doing
the same for Mainnet with its own env file and `CHAIN_ID=677`.

## What's already done for you (no action needed)

- `packages/internal-core` — BOT Chain (677/968) fully registered: viem
  `Chain` defs, `TOKENS` (bridged USDT, verified addresses, not fabricated),
  address placeholders, default RPC + explicit `eth_getLogs` warning.
- `packages/contracts/hardhat.config.ts` — `botTestnet` / `botMainnet`
  network entries + Blockscout verification wiring.
- All 9 deployment/ops scripts (`deploy.ts`, `deploy-continue.ts`, `smoke.ts`,
  `upgrade.ts`, `approve-token.ts`, `ops-plan-factory-owner.ts`,
  `import-live-state.ts`, `snapshot-live-state.ts`,
  `export-environment-manifest.ts`) know about chainId 677/968.
- Fixed a pre-existing bug in the facilitator (`keeper.ts`,
  `settlement-writer.ts`, `transport-axelar.ts`, `transport-ccip.ts`) where a
  stale local chain map caused signed transactions to embed the wrong
  chainId for any chain outside {Sepolia, Base Sepolia, Base Mainnet} —
  this was already silently wrong for Arc Testnet and would have repeated
  for BOT Chain.
- `apps/facilitator/src/server.ts` now supports `FACILITATOR_ENV_FILE` so a
  second chain's facilitator process can run without disturbing the first.

Everything above has been typechecked (`internal-core`, `facilitator`,
`arcen-backend`, all 3 SDKs) and the contracts compile
(`npx hardhat compile`, 72 Solidity files, cancun target). Steps 1–2 (testnet)
remain optional; steps 4–6 have been completed for BOT Chain Mainnet. Re-run
them only for a redeploy or upgrade.
