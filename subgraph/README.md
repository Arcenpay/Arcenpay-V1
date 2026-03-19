# ArcenPay Subgraph

Indexes MEAP + ZKVUB contract events for dashboard analytics.

## Commands

- `npm --prefix subgraph install`
- `npm --prefix subgraph run prepare:abis`
- `npm --prefix subgraph run sync:sepolia`
- `npm --prefix subgraph run codegen`
- `npm --prefix subgraph run build`
- `npm --prefix subgraph run deploy:studio` (default studio slug: `meap-sepolia`)
- `npm --prefix subgraph run deploy:studio:subscription-registry` (custom slug)

## Address Sync

The sync script updates `subgraph.yaml` using contract deployment output:

```bash
npm --prefix subgraph run sync:sepolia
```

To use a custom file/network:

```bash
node subgraph/scripts/sync-addresses.mjs --deployment ../packages/contracts/deployments/sepolia-latest.json --network sepolia
```

To sync a non-default subgraph manifest file:

```bash
node subgraph/scripts/sync-addresses.mjs --deployment ../packages/contracts/deployments/sepolia-latest.json --network base-sepolia --config subgraph.base-sepolia.yaml
```

## Graph Studio Deploy

Authenticate once:

```bash
graph auth <GRAPH_STUDIO_DEPLOY_KEY>
```

Then deploy:

```bash
npm --prefix subgraph run build
npm --prefix subgraph run deploy:studio:subscription-registry
```

If your CLI version does not support `--studio`, these scripts already use
the Studio node URL with non-interactive version labels.
