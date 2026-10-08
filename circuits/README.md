# ArcenPay ZKVUB Circuits

Groth16 zk-SNARK circuits powering ArcenPay's zero-knowledge usage settlement.
A provider proves that metered usage falls within a committed allowance without
revealing per-consumer transaction volumes.

## Tooling

The circuits are written in [Circom](https://docs.circom.io/) and use
[SnarkJS](https://github.com/iden3/snarkjs) for the trusted-setup ceremony,
proving, and verification key export.

```bash
npm install

# Compile UsageBilling.circom to r1cs + wasm + sym
npm run compile

# Run the Groth16 setup ceremony
npm run setup

# Export the verification key
npm run export-vkey

# Prove / verify against the sample input
npm run prove
npm run verify

# Run the circuit test suite
npm test
```

Local artifacts are written to `build/` and are not committed. The active artifact
version is pinned in `artifact-manifest.json`.

## Layout

```
UsageBilling.circom      # Circuit definition
input/                   # Sample witness input
proof/                   # Committed reference proof artifacts
scripts/                 # Compile / setup / prove / export helpers
test/                    # Circuit assertions
```
