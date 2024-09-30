#!/usr/bin/env bash
# ============================================================
#  ZKVUB Trusted Setup — Powers of Tau + Circuit-Specific Setup
#  PRD §7.3.1 — scripts/setup.sh
#
#  This script:
#    1. Downloads Powers of Tau file (if not present)
#    2. Compiles the Circom circuit
#    3. Runs Groth16 phase-2 trusted setup
#    4. Contributes randomness (non-interactive for CI)
#    5. Exports the verification key
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
PTAU_DIR="$ROOT_DIR/ptau"
ENSURE_SCRIPT="$SCRIPT_DIR/ensure-tooling.sh"

# Powers of Tau parameters
# pot17 supports circuits up to 2^17 = 131,072 constraints
# For 128 entries, our circuit has ~85k constraints
PTAU_FILE="${PTAU_FILE:-$PTAU_DIR/pot17_final.ptau}"
PTAU_URL="${PTAU_URL:-https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_17.ptau}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ZKVUB Trusted Setup — UsageBilling Circuit             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Step 0: Check prerequisites ──────────────────────────────
bash "$ENSURE_SCRIPT" circom
bash "$ENSURE_SCRIPT" snarkjs
if command -v snarkjs >/dev/null 2>&1; then
    SNARKJS="snarkjs"
else
    SNARKJS="$ROOT_DIR/node_modules/.bin/snarkjs"
fi

# ── Step 1: Download Powers of Tau ────────────────────────────
echo "📥 Step 1: Powers of Tau ceremony file"
mkdir -p "$PTAU_DIR"

if [ -f "$PTAU_FILE" ]; then
    echo "   ✅ Already present: $PTAU_FILE"
else
    if ! command -v curl >/dev/null 2>&1; then
        echo "❌ curl is required to download PTAU file."
        echo "   Provide a local file via PTAU_FILE env var, e.g.:"
        echo "   PTAU_FILE=/absolute/path/pot17_final.ptau npm run setup"
        exit 1
    fi
    echo "   Downloading from Hermez ceremony..."
    curl -fL -o "$PTAU_FILE" "$PTAU_URL"
    echo "   ✅ Downloaded: $PTAU_FILE"
fi

# ── Step 2: Compile Circuit ───────────────────────────────────
echo ""
echo "🔧 Step 2: Compiling UsageBilling.circom"
mkdir -p "$BUILD_DIR"

circom "$ROOT_DIR/UsageBilling.circom" \
    --r1cs \
    --wasm \
    --sym \
    -l "$ROOT_DIR/node_modules" \
    -o "$BUILD_DIR/"

echo "   ✅ R1CS:  $BUILD_DIR/UsageBilling.r1cs"
echo "   ✅ WASM:  $BUILD_DIR/UsageBilling_js/UsageBilling.wasm"
echo "   ✅ SYM:   $BUILD_DIR/UsageBilling.sym"

# Print circuit stats
$SNARKJS r1cs info "$BUILD_DIR/UsageBilling.r1cs"

# ── Step 3: Groth16 Phase-2 Setup ─────────────────────────────
echo ""
echo "🔑 Step 3: Groth16 trusted setup (phase 2)"

$SNARKJS groth16 setup \
    "$BUILD_DIR/UsageBilling.r1cs" \
    "$PTAU_FILE" \
    "$BUILD_DIR/circuit_0000.zkey"

echo "   ✅ Initial zkey: $BUILD_DIR/circuit_0000.zkey"

# ── Step 4: Contribute Randomness ─────────────────────────────
echo ""
echo "🎲 Step 4: Contributing randomness"

$SNARKJS zkey contribute \
    "$BUILD_DIR/circuit_0000.zkey" \
    "$BUILD_DIR/circuit_final.zkey" \
    --name="ArcenPay ZKVUB Ceremony" \
    -e="$(head -c 64 /dev/urandom | xxd -p -c 128)"

echo "   ✅ Final zkey: $BUILD_DIR/circuit_final.zkey"

# ── Step 5: Export Verification Key ───────────────────────────
echo ""
echo "📤 Step 5: Exporting verification key"

$SNARKJS zkey export verificationkey \
    "$BUILD_DIR/circuit_final.zkey" \
    "$BUILD_DIR/verification_key.json"

echo "   ✅ Verification key: $BUILD_DIR/verification_key.json"

# ── Done ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅ Setup complete!                                     ║"
echo "║                                                          ║"
echo "║  Next steps:                                             ║"
echo "║    npm run prove input/sample_input.json                 ║"
echo "║    npm run verify                                        ║"
echo "║    npm run export-solidity                               ║"
echo "╚══════════════════════════════════════════════════════════╝"
