# ArcenPay Subgraph

Indexes ArcenPay contract events for dashboard analytics and downstream protocol state.

## Commands

- `npm --prefix subgraph install`
- `npm --prefix subgraph run prepare:abis`
- `npm --prefix subgraph run sync:sepolia`
- `npm --prefix subgraph run codegen`
- `npm --prefix subgraph run build`
- `npm --prefix subgraph run deploy:studio`
- `npm --prefix subgraph run deploy:studio:subscription-registry`

## Address sync

The sync script updates `subgraph.yaml` from deployment output:

```bash
npm --prefix subgraph run sync:sepolia
```

Custom deployment or network:

```bash
node subgraph/scripts/sync-addresses.mjs --deployment ../packages/contracts/deployments/sepolia-latest.json --network sepolia
```

Custom manifest file:

```bash
node subgraph/scripts/sync-addresses.mjs --deployment ../packages/contracts/deployments/sepolia-latest.json --network base-sepolia --config subgraph.base-sepolia.yaml
```

## Graph Studio deploy

```bash
graph auth <GRAPH_STUDIO_DEPLOY_KEY>
npm --prefix subgraph run build
npm --prefix subgraph run deploy:studio:subscription-registry
```
