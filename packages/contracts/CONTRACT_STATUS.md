# Contract Status

This file is the source of truth for contract maturity in the current product.

## Core

These contracts are part of the live runtime and launch path:

- `PlanFactory`
- `SubscriptionRegistry`
- `ERC7579AutopayModule`
- `FeeCollector`
- `SessionVault`
- `ZKUsageVerifier`

## Optional

These contracts are wired, but not required for the primary subscription and billing flow:

- `MirrorRegistry`
- `YieldSessionVault`

## Experimental Frozen

These contracts are intentionally preserved for future work, but they are not part of the
current runtime integration, default deployments, or launch story:

- `FlagRegistry`
- `DIDRegistry`
- `MultisigVerifier`
- `ZKCredentialGate`
- `SubscriptionCollateralModule`
- `SubscriptionTransferPolicy`

## Policy

- Do not add experimental frozen contracts to the default SDK surface or runtime boot flow.
- Do not describe experimental frozen contracts as active product features in docs.
- Revive a frozen contract only when there is a concrete product requirement and an integration plan.
