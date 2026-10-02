#!/usr/bin/env bash
# ============================================================
#  ArcenPay — ONE-COMMAND Solana mainnet deploy
#
#  Run this. It handles everything:
#    1. creates the mainnet keypair if you don't have one
#    2. checks whether the funds have arrived and are enough
#    3. builds and deploys the program
#    4. prints what to do next
#
#  Safe to run repeatedly:
#    - no keypair      -> creates one and tells you the address to fund
#    - not funded yet  -> tells you exactly how much more is needed
#    - funded          -> deploys
#    - deploy failed   -> re-run: it RESUMES from the saved buffer, so the
#                         SOL already spent on the upload is reused
#
#  Usage:
#    packages/solana-programs/scripts/deploy-mainnet-all.sh
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$HERE/.." && pwd)"

KEYPAIR="${SOLANA_KEYPAIR:-$HOME/.config/solana/arcenpay-mainnet.json}"
CLUSTER="${SOLANA_CLUSTER:-mainnet-beta}"
RPC="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
SO="${SOLANA_SO:-$ROOT_DIR/target/deploy/arcenpay_solana.so}"

echo
echo "====================================================="
echo "  ArcenPay — Solana mainnet deploy"
echo "====================================================="
echo

# ── 1. Keypair ──────────────────────────────────────────────────────────────
if [ ! -f "$KEYPAIR" ]; then
  echo "→ No mainnet keypair found. Creating one…"
  echo
  "$HERE/setup-mainnet-keypair.sh" "$KEYPAIR"

  ADDRESS="$(solana-keygen pubkey "$KEYPAIR")"
  cat <<EOF

-----------------------------------------------------
  NEXT STEP: send ~1.7 SOL to

      $ADDRESS

  Then run this same script again and it will deploy.
  (Back up $KEYPAIR first — without it the funds are unrecoverable.)
-----------------------------------------------------
EOF
  exit 0
fi

# ── 2. Funds ────────────────────────────────────────────────────────────────
echo "→ Checking funds…"
echo
KEYPAIR="$KEYPAIR" CLUSTER="$CLUSTER" SOLANA_RPC_URL="$RPC" SOLANA_SO="$SO" \
  "$HERE/check-funds.sh" || true
echo

BALANCE_LAMPORTS="$(solana balance -k "$KEYPAIR" --url "$RPC" --lamports 2>/dev/null | awk '{print $1}')"
BALANCE_LAMPORTS="${BALANCE_LAMPORTS:-0}"

if [ "$BALANCE_LAMPORTS" = "0" ]; then
  echo "✗ No SOL at $(solana-keygen pubkey "$KEYPAIR") yet."
  echo "  Send SOL to that address on $CLUSTER, then run this script again."
  exit 1
fi

[ -f "$SO" ] || { echo "✗ Program artifact not found: $SO"; echo "  Build it first: npm run build:sbf"; exit 1; }

if stat -f%z "$SO" >/dev/null 2>&1; then SO_BYTES="$(stat -f%z "$SO")"; else SO_BYTES="$(stat -c%s "$SO")"; fi
RENT_SOL="$(solana rent "$SO_BYTES" --url "$RPC" 2>/dev/null | awk '/Rent-exempt minimum/{print $3}')"
if [ -n "${RENT_SOL:-}" ]; then
  NEEDED="$(awk -v r="$RENT_SOL" 'BEGIN{printf "%.9f", r+0.005}')"
  ENOUGH="$(awk -v b="$BALANCE_LAMPORTS" -v n="$NEEDED" 'BEGIN{print (b/1000000000+0 >= n+0) ? "yes" : "no"}')"
  if [ "$ENOUGH" != "yes" ]; then
    SHORT="$(awk -v b="$BALANCE_LAMPORTS" -v n="$NEEDED" 'BEGIN{printf "%.9f", n-(b/1000000000)}')"
    echo "✗ Not enough SOL yet — short by $SHORT SOL."
    echo "  Send at least $SHORT SOL to: $(solana-keygen pubkey "$KEYPAIR")"
    echo "  Then run this script again."
    exit 1
  fi
fi

# ── 3. Deploy ───────────────────────────────────────────────────────────────
echo "Everything checks out. About to build and deploy to MAINNET."
read -r -p "Type 'yes' to continue: " OK
[ "$OK" = "yes" ] || { echo "Aborted."; exit 1; }
echo

SOLANA_KEYPAIR="$KEYPAIR" \
SOLANA_CLUSTER="$CLUSTER" \
SOLANA_RPC_URL="$RPC" \
  "$HERE/deploy-solana.sh"

PROGRAM_ID="$(solana-keygen pubkey "$ROOT_DIR/target/deploy/arcenpay_solana-keypair.json" 2>/dev/null || echo "")"

cat <<EOF

=====================================================
  ✅ DEPLOYED
=====================================================
  program id: ${PROGRAM_ID:-<see above>}
  cluster   : $CLUSTER

  NEXT — two one-time steps the script cannot do:

  1. Initialize the program config (admin-only):
       initialize_config(treasury=<treasury pubkey>, fee_bps=50)

  2. Create the treasury's token account (required before the
     first subscribe, otherwise you get AccountNotInitialized):
       spl-token create-account <USDC_MINT> \\
         --owner <treasury pubkey> --url $CLUSTER -k $KEYPAIR

  Then register the program id (all 7 roles = the same id):
       ARCENPAY_CONTRACT_9100000_subscriptionRegistry=${PROGRAM_ID:-<program id>}
       … and the same for autopayModule, planFactory, feeCollector,
         sessionVault, zkUsageVerifier, mirrorRegistry

  The ~${RENT_SOL:-1.65} SOL rent is still yours —
  'solana program close <program id>' returns it.
=====================================================
EOF
