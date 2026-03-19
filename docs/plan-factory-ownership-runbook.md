# PlanFactory Smart Ownership Runbook

Production-grade ownership flow for `PlanFactory` using Safe/multisig.

## Goal

- No single private key controls provider onboarding.
- Dashboard relayer can create plans without owning protocol admin rights.
- Owner actions are executed through Safe with auditable calldata.

## Recommended Setup

- `PlanFactory.owner` = Safe multisig.
- Dashboard relayer key (`DEPLOYER_PRIVATE_KEY`) is a normal provider wallet.
- `PLAN_FACTORY_OWNER_PRIVATE_KEY` stays empty in dashboard.
- `PLAN_FACTORY_OWNER_ADDRESS` is set to your Safe address.

## 1) Inspect Current Ownership + Provider State

```bash
MODE=inspect \
PROVIDER_ADDRESS=0xRelayerAddress \
npm --prefix packages/contracts run ops:plan-factory-owner
```

This prints:
- `owner`
- `ownerIsContract` (true for Safe)
- `providerRegistered`

## 2) Transfer Ownership to Safe (one-time, from current owner EOA)

```bash
MODE=transfer-owner \
NEW_OWNER_ADDRESS=0xYourSafeAddress \
npm --prefix packages/contracts run ops:plan-factory-owner
```

## 3) Register Relayer Provider via Safe

Generate calldata payload:

```bash
MODE=calldata-register-provider \
PROVIDER_ADDRESS=0xRelayerAddress \
npm --prefix packages/contracts run ops:plan-factory-owner
```

Submit returned payload in Safe:
- `to` = PlanFactory
- `value` = `0`
- `data` = encoded `registerProvider(address)`
- `operation` = `0` (CALL)

## 4) Dashboard Env (safe mode)

Set in dashboard env:

```bash
PLAN_FACTORY_OWNER_ADDRESS=0xYourSafeAddress
PLAN_FACTORY_OWNER_PRIVATE_KEY=
```

The API validates owner consistency and returns Safe payload automatically when owner action is needed.

## 5) Verify End-to-End

1. Create a draft/published plan in dashboard.
2. Trigger `Register On-Chain`.
3. Expected:
   - If relayer already registered: plan sync succeeds.
   - If not registered: API returns `ownerActionRequired` payload, then Safe executes, then retry succeeds.

