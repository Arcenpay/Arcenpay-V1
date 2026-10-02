#!/usr/bin/env bash
# ============================================================
#  ArcenPay — withdraw SOL (interactive)
#
#  Just run it and answer two questions:
#    1. the destination wallet address
#    2. the amount in SOL  (press Enter for the max / everything)
#
#  Usage:
#    packages/solana-programs/scripts/withdraw-sol.sh
#
#  Optional overrides (otherwise it just asks):
#    KEYPAIR=~/.config/solana/other.json      which keypair to send FROM
#    CLUSTER=devnet                           which network
# ============================================================
set -euo pipefail

KEYPAIR="${KEYPAIR:-${SOLANA_KEYPAIR:-$HOME/.config/solana/arcenpay-mainnet.json}}"
CLUSTER="${CLUSTER:-${SOLANA_CLUSTER:-mainnet-beta}}"
RPC="${SOLANA_RPC_URL:-}"

die() { echo "✗ $*" >&2; exit 1; }

command -v solana >/dev/null 2>&1 || die "'solana' CLI not found on PATH."
[ -f "$KEYPAIR" ] || die "Keypair not found: $KEYPAIR"

RPC_ARGS=(--url "$CLUSTER")
[ -n "$RPC" ] && RPC_ARGS=(--url "$RPC")
TARGET="${RPC:-$CLUSTER}"

SOURCE="$(solana-keygen pubkey "$KEYPAIR")"
LAMPORTS="$(solana balance -k "$KEYPAIR" "${RPC_ARGS[@]}" --lamports 2>/dev/null | awk '{print $1}')"
LAMPORTS="${LAMPORTS:-0}"
BALANCE_SOL="$(awk -v l="$LAMPORTS" 'BEGIN{printf "%.9f", l/1000000000}')"

echo "====================================================="
echo "  ArcenPay — withdraw SOL"
echo "====================================================="
echo "  cluster : $TARGET"
echo "  from    : $SOURCE"
echo "  keypair : $KEYPAIR"
echo "  balance : $BALANCE_SOL SOL"
echo

if [ "$LAMPORTS" = "0" ]; then
  echo "⚠ This address has 0 SOL — nothing to send."
  exit 1
fi

# ── 1. Destination ──────────────────────────────────────────────────────────
while :; do
  read -r -p "Destination wallet address: " DEST
  DEST="$(echo "$DEST" | tr -d '[:space:]')"
  [ -n "$DEST" ] || { echo "  (required — paste the address you want to send to)"; continue; }

  if ! echo "$DEST" | grep -qE '^[1-9A-HJ-NP-Za-km-z]{32,44}$'; then
    echo "  ✗ That does not look like a Solana address (base58, 32–44 chars). Try again."
    continue
  fi
  if [ "$DEST" = "$SOURCE" ]; then
    echo "  ✗ That is the address you are sending FROM. Try again."
    continue
  fi
  break
done

# ── 2. Amount ───────────────────────────────────────────────────────────────
echo
read -r -p "Amount in SOL (press Enter to send everything = $BALANCE_SOL): " AMOUNT
AMOUNT="$(echo "$AMOUNT" | tr -d '[:space:]')"

if [ -z "$AMOUNT" ]; then
  AMOUNT="ALL"
else
  if ! echo "$AMOUNT" | grep -qE '^[0-9]+(\.[0-9]+)?$'; then
    die "'$AMOUNT' is not a valid amount."
  fi
  ENOUGH="$(awk -v a="$AMOUNT" -v b="$BALANCE_SOL" 'BEGIN{print (a+0 <= b+0) ? "yes" : "no"}')"
  if [ "$ENOUGH" != "yes" ]; then
    die "You asked for $AMOUNT SOL but the balance is only $BALANCE_SOL SOL."
  fi
fi

# ── 3. Confirm ──────────────────────────────────────────────────────────────
echo
echo "-----------------------------------------------------"
echo "  Sending : $AMOUNT SOL"
echo "  From    : $SOURCE"
echo "  To      : $DEST"
echo "  Network : $TARGET"
echo "-----------------------------------------------------"
echo
echo "⚠ A Solana transfer is IRREVERSIBLE. If the destination is wrong,"
echo "  the SOL is gone and nobody can recover it."
echo
read -r -p "Type 'send' to confirm: " OK
[ "$OK" = "send" ] || { echo "Aborted — nothing was sent."; exit 1; }
echo

# ── 4. Send ─────────────────────────────────────────────────────────────────
# --fee-payer so the sender always pays the fee, even to a brand-new address.
solana transfer "$DEST" "$AMOUNT" \
  --from "$KEYPAIR" --fee-payer "$KEYPAIR" \
  --allow-unfunded-recipient "${RPC_ARGS[@]}"

AFTER_LAMPORTS="$(solana balance -k "$KEYPAIR" "${RPC_ARGS[@]}" --lamports 2>/dev/null | awk '{print $1}')"
AFTER_LAMPORTS="${AFTER_LAMPORTS:-0}"
AFTER_SOL="$(awk -v l="$AFTER_LAMPORTS" 'BEGIN{printf "%.9f", l/1000000000}')"

echo
echo "✓ Sent."
echo "  before : $BALANCE_SOL SOL"
echo "  after  : $AFTER_SOL SOL"

cat <<EOF

-----------------------------------------------------
  SOL can also be held in two other places:

  1. A program's rent deposit (~1.647 SOL per deploy):
       solana program close <program-id> ${RPC_ARGS[*]}
     (this DESTROYS the program — only if you are done with it)

  2. A stranded upload buffer from a failed deploy:
       solana program close <buffer-address> ${RPC_ARGS[*]}
-----------------------------------------------------
EOF
