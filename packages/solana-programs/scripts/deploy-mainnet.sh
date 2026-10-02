#!/usr/bin/env bash
# ============================================================
#  ArcenPay — MAINNET program deploy (guided, with preflight)
#
#  Your secret key never leaves this machine: it is read from a local keypair
#  file. It is deliberately NOT accepted as a command-line argument or an env
#  var, because arguments leak through `ps` and shell history.
#
#  What it does:
#    1. Preflight — binaries, keypair location, program size, rent requirement
#       and whether the wallet can actually afford the deploy.
#    2. Shows the exact SOL that will be locked (rent) vs. spent (fees).
#    3. Requires a typed confirmation, then deploys via deploy-solana.sh.
#    4. Prints the env vars to register the program id.
#
#  Usage:
#    SOLANA_KEYPAIR=~/.config/solana/arcenpay-mainnet.json \
#    SOLANA_RPC_URL=https://your-paid-mainnet-rpc \
#      scripts/deploy-mainnet.sh
# ============================================================
set -euo pipefail

KEYPAIR="${SOLANA_KEYPAIR:-$HOME/.config/solana/arcenpay-mainnet.json}"
PROGRAM_KEYPAIR="${SOLANA_PROGRAM_KEYPAIR:-}"
RPC="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$HERE/.." && pwd)"
SO="${SOLANA_SO:-$ROOT_DIR/target/deploy/arcenpay_solana.so}"

die() { echo "✗ $*" >&2; exit 1; }

for bin in solana solana-keygen cargo-build-sbf; do
  command -v "$bin" >/dev/null 2>&1 || die "'$bin' not found on PATH."
done

# ── Keypair must exist and must NOT live inside the repository ───────────────
[ -f "$KEYPAIR" ] || die "Keypair not found: $KEYPAIR
  Create one first: scripts/setup-mainnet-keypair.sh"

KEYPAIR_ABS="$(cd "$(dirname "$KEYPAIR")" && pwd)/$(basename "$KEYPAIR")"
case "$KEYPAIR_ABS" in
  "$ROOT_DIR"/*|"$(cd "$ROOT_DIR/../.." && pwd)"/*)
    die "Refusing to use a keypair stored inside the repository:
    $KEYPAIR_ABS
  Move it outside (e.g. ~/.config/solana/arcenpay-mainnet.json) so it can
  never be committed." ;;
esac

# ── Program artifact + size-dependent rent ──────────────────────────────────
[ -f "$SO" ] || die "Program artifact not found: $SO
  Build it first (scripts/deploy-solana.sh with SOLANA_CLUSTER=devnet does this)."

if stat -f%z "$SO" >/dev/null 2>&1; then SO_BYTES="$(stat -f%z "$SO")"; else SO_BYTES="$(stat -c%s "$SO")"; fi
SO_KB=$(( SO_BYTES / 1024 ))

echo "→ Cluster:  $RPC"
echo "→ Keypair:  $KEYPAIR_ABS"
echo "→ Artifact: $SO  ($SO_BYTES bytes ≈ ${SO_KB} KB)"
echo

AUTHORITY="$(solana-keygen pubkey "$KEYPAIR")"
BALANCE_LAMPORTS="$(solana balance -k "$KEYPAIR" -u "$RPC" --lamports 2>/dev/null | awk '{print $1}')" \
  || BALANCE_LAMPORTS=0
BALANCE_SOL="$(awk -v l="${BALANCE_LAMPORTS:-0}" 'BEGIN{printf "%.9f", l/1000000000}')"

RENT_OUT="$(solana rent "$SO_BYTES" -u "$RPC" 2>/dev/null || true)"
RENT_SOL="$(echo "$RENT_OUT" | awk '/Rent-exempt minimum/{print $3}')"
[ -n "${RENT_SOL:-}" ] || die "Could not read the rent requirement from the RPC ($RPC). Try again or set a different SOLANA_RPC_URL."

# ~0.005 SOL covers the program account + the hundreds of chunk transactions.
FEES_SOL="0.005"
REQUIRED_SOL="$(awk -v r="$RENT_SOL" -v f="$FEES_SOL" 'BEGIN{printf "%.9f", r+f}')"

echo "  authority : $AUTHORITY"
echo "  balance   : $BALANCE_SOL SOL"
echo
echo "  ┌──────────────────────────────────────────────────────────────┐"
echo "  │  Rent-exempt deposit (REFUNDABLE on close/upgrade)           │"
echo "  │    $RENT_SOL SOL"
echo "  │  Transaction fees (the real, permanent cost)                 │"
echo "  │    ~$FEES_SOL SOL"
echo "  │  ----------------------------------------------------------  │"
echo "  │  Total that must be available: $REQUIRED_SOL SOL"
echo "  └──────────────────────────────────────────────────────────────┘"
echo

AFFORDABLE="$(awk -v b="$BALANCE_SOL" -v n="$REQUIRED_SOL" 'BEGIN{print (b+0 >= n+0) ? "yes" : "no"}')"
if [ "$AFFORDABLE" != "yes" ]; then
  SHORT="$(awk -v b="$BALANCE_SOL" -v n="$REQUIRED_SOL" 'BEGIN{printf "%.9f", n-b}')"
  die "Not enough SOL to deploy.
    have: $BALANCE_SOL SOL
    need: $REQUIRED_SOL SOL (short by $SHORT SOL)
  Send SOL to: $AUTHORITY"
fi

echo "  This deploys to MAINNET and cannot be undone (it can only be upgraded)."
echo "  Type exactly:  DEPLOY MAINNET"
read -r -p "> " CONFIRM
[ "$CONFIRM" = "DEPLOY MAINNET" ] || die "Aborted."

echo
echo "→ Building + deploying…"
SOLANA_CLUSTER="mainnet-beta" \
SOLANA_KEYPAIR="$KEYPAIR" \
SOLANA_RPC_URL="$RPC" \
${PROGRAM_KEYPAIR:+SOLANA_PROGRAM_KEYPAIR="$PROGRAM_KEYPAIR"} \
  "$HERE/deploy-solana.sh"

echo
echo "✓ Mainnet deploy complete."
echo "  Register the program id (Solana synthesises 7 roles from one program):"
for role in subscriptionRegistry autopayModule planFactory feeCollector sessionVault zkUsageVerifier mirrorRegistry; do
  echo "    ARCENPAY_CONTRACT_9100000_${role}=<program id printed above>"
done
echo
echo "  The rent ($RENT_SOL SOL) is still yours — 'solana program close <id>'"
echo "  refunds it if you ever stop using the program."
