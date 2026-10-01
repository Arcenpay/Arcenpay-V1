#!/usr/bin/env bash
# ============================================================
#  Deploy the ArcenPay Solana program
#
#  Builds the SBF artifact, aligns `declare_id!`/Anchor.toml with the
#  deploy keypair (the `anchor keys sync` equivalent), deploys, and prints
#  the env vars to register the program id with the backend/facilitator.
#
#  Usage:
#    SOLANA_CLUSTER=devnet SOLANA_KEYPAIR=~/.config/solana/id.json \
#      scripts/deploy-solana.sh
#
#  Requires: solana CLI + cargo-build-sbf on PATH, a funded keypair.
# ============================================================
set -euo pipefail

CLUSTER="${SOLANA_CLUSTER:-devnet}"
KEYPAIR="${SOLANA_KEYPAIR:-$HOME/.config/solana/id.json}"
RPC="${SOLANA_RPC_URL:-}"
PROGRAM_NAME="arcenpay_solana"
CRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/programs/arcenpay-solana"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for bin in solana cargo-build-sbf; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "✗ '$bin' not found on PATH. Install the Solana CLI first." >&2
    exit 1
  fi
done

if [ ! -f "$KEYPAIR" ]; then
  echo "✗ Payer keypair not found: $KEYPAIR" >&2
  exit 1
fi

# Safety: never let a signing key live inside the repo (it could be committed).
KEYPAIR_ABS="$(cd "$(dirname "$KEYPAIR")" && pwd)/$(basename "$KEYPAIR")"
case "$KEYPAIR_ABS" in
  "$ROOT_DIR"/*)
    echo "✗ The payer keypair is inside the repository:" >&2
    echo "    $KEYPAIR_ABS" >&2
    echo "  Move it outside (e.g. ~/.config/solana/devnet.json) so it cannot be committed." >&2
    exit 1
    ;;
esac

echo "→ Building SBF artifact…"
( cd "$CRATE_DIR" && cargo-build-sbf )

PROGRAM_KEYPAIR="$ROOT_DIR/target/deploy/${PROGRAM_NAME}-keypair.json"
if [ ! -f "$PROGRAM_KEYPAIR" ]; then
  echo "✗ Program keypair not found: $PROGRAM_KEYPAIR (did cargo-build-sbf run?)" >&2
  exit 1
fi

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
echo "→ Program id: $PROGRAM_ID"

# `anchor keys sync` equivalent: declare_id! and Anchor.toml must match the
# deploy keypair or the program fails at runtime with DeclaredProgramIdMismatch.
echo "→ Syncing declare_id! and Anchor.toml with the deploy keypair…"
sed -i.bak -E "s/declare_id!\(\"[^\"]*\"\)/declare_id!(\"$PROGRAM_ID\")/" "$CRATE_DIR/src/lib.rs"
rm -f "$CRATE_DIR/src/lib.rs.bak"
sed -i.bak -E "s/arcenpay_solana = \"[^\"]*\"/arcenpay_solana = \"$PROGRAM_ID\"/g" "$ROOT_DIR/Anchor.toml"
rm -f "$ROOT_DIR/Anchor.toml.bak"

# Rebuild so the embedded id matches before deploying.
( cd "$CRATE_DIR" && cargo-build-sbf )

RPC_ARGS=(--url "$CLUSTER")
if [ -n "$RPC" ]; then RPC_ARGS=(--url "$RPC"); fi

echo "→ Deploying to ${RPC:-$CLUSTER}…"
solana program deploy \
  "${RPC_ARGS[@]}" \
  -k "$KEYPAIR" \
  --program-id "$PROGRAM_KEYPAIR" \
  "$ROOT_DIR/target/deploy/${PROGRAM_NAME}.so"

echo
echo "✓ Deployed $PROGRAM_ID to ${RPC:-$CLUSTER}"
echo
echo "Register the program id so the platform can reach it. For devnet (9100001):"
echo "  ARCENPAY_CONTRACT_9100001_subscriptionRegistry=$PROGRAM_ID"
echo "  ARCENPAY_CONTRACT_9100001_autopayModule=$PROGRAM_ID"
echo "  ARCENPAY_CONTRACT_9100001_planFactory=$PROGRAM_ID"
echo "  ARCENPAY_CONTRACT_9100001_feeCollector=$PROGRAM_ID"
echo "  ARCENPAY_CONTRACT_9100001_sessionVault=$PROGRAM_ID"
echo "  ARCENPAY_CONTRACT_9100001_zkUsageVerifier=$PROGRAM_ID"
echo "  ARCENPAY_CONTRACT_9100001_mirrorRegistry=$PROGRAM_ID"
echo
echo "Then initialize the program (admin-only):"
echo "  initialize_config(treasury=<treasury pubkey>, fee_bps=50)"
