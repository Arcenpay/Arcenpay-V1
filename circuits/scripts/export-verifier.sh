#!/usr/bin/env bash
# ============================================================
#  ZKVUB Export Solidity Verifier
#  PRD §7.3.1 — scripts/export-verifier.sh
#
#  Exports a Groth16 Solidity verifier from the final zkey.
#  The generated contract implements IGroth16Verifier and can
#  be deployed alongside ZKUsageVerifier.sol.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
OUTPUT_DIR="$ROOT_DIR/contracts"
ZKEY_FILE="$BUILD_DIR/circuit_final.zkey"
OUTPUT_FILE="$OUTPUT_DIR/Groth16Verifier.sol"

command -v snarkjs >/dev/null 2>&1 || {
    echo "⚠️  snarkjs not in PATH, trying npx..."
    SNARKJS="npx snarkjs"
}
SNARKJS="${SNARKJS:-snarkjs}"

if [ ! -f "$ZKEY_FILE" ]; then
    echo "❌ Missing $ZKEY_FILE"
    echo "   Run 'npm run setup' first to generate the trusted setup."
    exit 1
fi

echo "📤 Exporting Solidity Groth16 verifier..."
mkdir -p "$OUTPUT_DIR"

$SNARKJS zkey export solidityverifier "$ZKEY_FILE" "$OUTPUT_FILE"

echo "   ✅ Verifier contract: $OUTPUT_FILE"
echo ""
echo "To use with ZKUsageVerifier.sol:"
echo "  1. Deploy Groth16Verifier.sol"
echo "  2. Call zkUsageVerifier.setGroth16Verifier(deployedAddress)"
