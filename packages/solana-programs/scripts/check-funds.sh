#!/usr/bin/env bash
# ============================================================
#  ArcenPay — check deploy funds
#
#  Answers: "did the money I sent arrive, and is it enough to deploy?"
#
#  Shows the address your keypair controls, its balance, the exact rent the
#  current program artifact needs, and whether you are short.
#
#  Usage:
#    packages/solana-programs/scripts/check-funds.sh
#    KEYPAIR=~/.config/solana/arcenpay-mainnet.json scripts/check-funds.sh
#    CLUSTER=devnet scripts/check-funds.sh
# ============================================================
set -euo pipefail

KEYPAIR="${KEYPAIR:-${SOLANA_KEYPAIR:-$HOME/.config/solana/arcenpay-mainnet.json}}"
CLUSTER="${CLUSTER:-mainnet-beta}"
RPC="${SOLANA_RPC_URL:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$HERE/.." && pwd)"
SO="${SOLANA_SO:-$ROOT_DIR/target/deploy/arcenpay_solana.so}"

die() { echo "✗ $*" >&2; exit 1; }

command -v solana >/dev/null 2>&1 || die "'solana' CLI not found on PATH."
[ -f "$KEYPAIR" ] || die "Keypair not found: $KEYPAIR
  Create one with: scripts/setup-mainnet-keypair.sh"

RPC_ARGS=(--url "$CLUSTER")
[ -n "$RPC" ] && RPC_ARGS=(--url "$RPC")
TARGET="${RPC:-$CLUSTER}"

AUTHORITY="$(solana-keygen pubkey "$KEYPAIR")"
BALANCE_LAMPORTS="$(solana balance -k "$KEYPAIR" "${RPC_ARGS[@]}" --lamports 2>/dev/null | awk '{print $1}')"
BALANCE_LAMPORTS="${BALANCE_LAMPORTS:-0}"
BALANCE_SOL="$(awk -v l="$BALANCE_LAMPORTS" 'BEGIN{printf "%.9f", l/1000000000}')"

if stat -f%z "$SO" >/dev/null 2>&1; then SO_BYTES="$(stat -f%z "$SO")"; else SO_BYTES="$(stat -c%s "$SO")"; fi

echo "====================================================="
echo "  ArcenPay — deploy funds"
echo "====================================================="
echo "  cluster   : $TARGET"
echo "  keypair   : $KEYPAIR"
echo "  address   : $AUTHORITY"
echo
echo "  BALANCE   : $BALANCE_SOL SOL"
echo

if [ "$BALANCE_LAMPORTS" = "0" ]; then
  echo "  ⚠ Nothing at this address yet."
  echo "    If you already sent SOL, check that you sent it to the address above"
  echo "    — and to the same cluster ($TARGET)."
  echo
fi

# ── What a deploy actually needs ────────────────────────────────────────────
RENT_OUT="$(solana rent "$SO_BYTES" "${RPC_ARGS[@]}" 2>/dev/null || true)"
RENT_SOL="$(echo "$RENT_OUT" | awk '/Rent-exempt minimum/{print $3}')"
if [ -n "${RENT_SOL:-}" ]; then
  # The CLI moves the buffered bytes into the ProgramData account rather than
  # double-funding, so the real total is rent + transaction fees. Measured on a
  # real deploy: 324,128 bytes cost 1.64990720 SOL all-in against a rent of
  # 1.64722048. Fees for a chunked upload are ~0.003 SOL.
  FEES_SOL="0.003"
  REQUIRED_SOL="$(awk -v r="$RENT_SOL" -v f="$FEES_SOL" 'BEGIN{printf "%.9f", r+f}')"
  echo "  artifact  : $SO_BYTES bytes"
  echo "  rent      : $RENT_SOL SOL   (REFUNDABLE — solana program close)"
  echo "  fees      : ~$FEES_SOL SOL  (permanent)"
  echo "  NEEDED    : $REQUIRED_SOL SOL"
  echo
  echo "  NOTE: rent scales with size. Building with opt-level=z keeps the"
  echo "        artifact small (324 KB vs 398 KB), which is the difference"
  echo "        between needing 1.65 SOL and 2.03 SOL."
  echo

  awk -v b="$BALANCE_SOL" -v n="$REQUIRED_SOL" 'BEGIN{
    if (b+0 >= n+0) {
      printf "  ✅ READY TO DEPLOY — surplus %.9f SOL\n", b-n;
    } else {
      printf "  ✗ SHORT BY %.9f SOL\n", n-b;
      printf "     Fund %s with at least %.9f SOL.\n", "", n-b;
    }
  }'
  awk -v b="$BALANCE_SOL" -v r="${RENT_SOL:-0}" 'BEGIN{
    if (b+0 >= r+0) printf "  ↩ %.9f SOL of this is refundable rent.\n", r;
  }'
else
  echo "  ⚠ Could not read the rent requirement from $TARGET."
  [ -f "$SO" ] || echo "    (program artifact not found at: $SO — build it first)"
fi

# ── A stranded upload buffer is recoverable money ───────────────────────────
BUFFER_STATE="$ROOT_DIR/target/deploy/.arcenpay_solana-buffer"
if [ -s "$BUFFER_STATE" ]; then
  echo
  echo "  ⚠ Unfinished deploy buffer: $(tr -d '[:space:]' < "$BUFFER_STATE")"
  echo "    That SOL is parked, not spent. Re-run deploy-mainnet.sh to resume,"
  echo "    or reclaim it:  solana program close $(tr -d '[:space:]' < "$BUFFER_STATE")"
fi

echo
echo "  Reclaim anything later with:"
echo "    solana program close <program-id>   # the rent"
echo "    solana transfer --from $KEYPAIR <your-wallet> ALL ${RPC_ARGS[*]}"
echo "====================================================="
