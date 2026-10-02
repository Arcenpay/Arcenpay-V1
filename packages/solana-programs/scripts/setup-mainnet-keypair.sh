#!/usr/bin/env bash
# ============================================================
#  Create the ArcenPay mainnet keypair (run this ONCE)
#
#  A Solana "keypair" is just a file holding a public key + its secret key.
#  The public half is your address (safe to share, needed to receive SOL).
#  The secret half signs transactions — anyone who has it fully controls the
#  funds and can replace the deployed program. It must never leave this machine.
#
#  This script prints ONLY the public address. Keep the file backed up.
#
#  Usage:
#    scripts/setup-mainnet-keypair.sh [output-path]
# ============================================================
set -euo pipefail

OUT="${1:-$HOME/.config/solana/arcenpay-mainnet.json}"

if ! command -v solana-keygen >/dev/null 2>&1; then
  echo "✗ 'solana-keygen' not found. Install the Solana CLI first." >&2
  exit 1
fi

if [ -e "$OUT" ]; then
  echo "✗ Refusing to overwrite an existing key: $OUT" >&2
  echo "  Delete it manually first if you really mean to replace it." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
chmod 700 "$(dirname "$OUT")"

echo "→ Generating a new keypair at $OUT"
echo "  (a 12-word recovery phrase will be printed once — write it down)"
echo
solana-keygen new --no-bip39-passphrase --outfile "$OUT"
chmod 600 "$OUT"

PUBKEY="$(solana-keygen pubkey "$OUT")"

echo
echo "============================================================"
echo "  Public address (safe to share, fund this):"
echo "    $PUBKEY"
echo "============================================================"
echo
echo "⚠ BACK THIS FILE UP NOW — it is the only copy of the secret key:"
echo "    $OUT"
echo "  • Copy it into a password manager or offline storage."
echo "  • Without it you cannot upgrade or close the program, and the rent"
echo "    locked in the program account is unrecoverable."
echo "  • Never commit it. Never paste it into a chat, issue, or screenshot."
echo
echo "Next steps:"
echo "  1. Send ~1.7 SOL to the address above (mainnet)."
echo "  2. Run: scripts/deploy-mainnet.sh"
