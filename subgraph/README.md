# ArcenPay Subgraph

Indexes MEAP + ZKVUB contract events for dashboard analytics.

## Commands

- `npm --prefix subgraph install`
- `npm --prefix subgraph run prepare:abis`
- `npm --prefix subgraph run sync:sepolia`
- `npm --prefix subgraph run codegen`
- `npm --prefix subgraph run build`

## Address Sync

The sync script updates `subgraph.yaml` using contract deployment output:

```bash
npm --prefix subgraph run sync:sepolia
```

To use a custom file/network:

```bash
node subgraph/scripts/sync-addresses.mjs --deployment ../packages/contracts/deployments/sepolia-latest.json --network sepolia
```
