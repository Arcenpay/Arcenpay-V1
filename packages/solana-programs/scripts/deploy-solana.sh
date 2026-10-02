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

# SIZE MATTERS: rent is charged per byte of program, so the optimization level
# directly determines how much SOL you must lock up.
#   default release build : ~398 KB -> 2.027 SOL rent
#   opt-level = "z"       : ~324 KB -> 1.647 SOL rent   (-19%)
# Set SOLANA_OPT_LEVEL=3 (or "") to build at the default size instead.
OPT_LEVEL="${SOLANA_OPT_LEVEL-z}"

echo "→ Building SBF artifact… (opt-level=${OPT_LEVEL:-default})"
( cd "$CRATE_DIR" && CARGO_PROFILE_RELEASE_OPT_LEVEL="$OPT_LEVEL" cargo-build-sbf )

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

# Rebuild so the embedded id matches before deploying (same opt-level, so the
# artifact stays the small one whose rent we budgeted for).
( cd "$CRATE_DIR" && CARGO_PROFILE_RELEASE_OPT_LEVEL="$OPT_LEVEL" cargo-build-sbf )

RPC_ARGS=(--url "$CLUSTER")
if [ -n "$RPC" ]; then RPC_ARGS=(--url "$RPC"); fi

# ── Resumable deploy ────────────────────────────────────────────────────────
# `solana program deploy` uploads the program into a BUFFER account first, then
# moves it into the ProgramData account. If the deploy runs out of SOL mid-way
# (or is interrupted), the buffer STILL EXISTS and still holds the rent you
# already paid for the upload.
#
# Pass that buffer back with `--buffer <address>` and the CLI skips the upload
# entirely — you do NOT pay for it twice. The address is persisted below after a
# failed attempt, so simply re-running this script resumes automatically.
BUFFER_STATE="$ROOT_DIR/target/deploy/.${PROGRAM_NAME}-buffer"
DEPLOY_ARGS=("${RPC_ARGS[@]}" -k "$KEYPAIR" --program-id "$PROGRAM_KEYPAIR")

if [ -s "$BUFFER_STATE" ]; then
  EXISTING_BUFFER="$(tr -d '[:space:]' < "$BUFFER_STATE")"
  if [ -n "$EXISTING_BUFFER" ]; then
    echo "→ Found an in-progress buffer from a previous run: $EXISTING_BUFFER"
    echo "  Resuming from it — the SOL already spent on this upload is reused,"
    echo "  so you only pay the remainder."
    DEPLOY_ARGS+=(--buffer "$EXISTING_BUFFER")
  fi
fi

echo "→ Deploying to ${RPC:-$CLUSTER}…"
DEPLOY_LOG="$(mktemp -t arcenpay-deploy)"
if solana program deploy \
  "${DEPLOY_ARGS[@]}" \
  "$ROOT_DIR/target/deploy/${PROGRAM_NAME}.so" 2>&1 | tee "$DEPLOY_LOG"; then
  rm -f "$BUFFER_STATE"
else
  # On failure the CLI prints `solana program close <BUFFER_ADDRESS>`, which is
  # also the buffer we can resume from.
  RESCUED="$(grep -oE 'solana program close [1-9A-HJ-NP-Za-km-z]+' "$DEPLOY_LOG" | awk '{print $NF}' | head -1)"
  echo
  if [ -n "$RESCUED" ]; then
    echo "$RESCUED" > "$BUFFER_STATE"
    echo "✗ Deploy did not finish — but nothing is wasted."
    echo "    Upload saved in buffer: $RESCUED"
    echo
    echo "  → Re-run this script to RESUME. It reuses that buffer, so the SOL you"
    echo "    already spent on the upload is NOT charged again."
    echo "  → To recover the lamports instead:  solana program close $RESCUED"
  else
    echo "✗ Deploy failed before a buffer was recorded. See the log above."
    echo "  Re-running is safe — it starts a fresh buffer."
  fi
  exit 1
fi

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
echo
echo "⚠ REQUIRED before the first subscribe: create the TREASURY's token account."
echo "  Subscribe transfers the protocol fee into it, and the program expects the"
echo "  account to already exist (Anchor AccountNotInitialized / 3012 otherwise)."
echo "  Anyone can pay the rent — the treasury does not need to sign:"
echo "    spl-token create-account <ACCEPTED_MINT> \\"
echo "      --owner <treasury pubkey> --url ${CLUSTER:-devnet} -k $KEYPAIR"
echo "  For devnet USDC that is mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU."
