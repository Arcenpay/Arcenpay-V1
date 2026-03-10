#!/usr/bin/env bash
# ============================================================
#  ZKVUB Artifact Deploy — circuits/build/ → facilitator/circuits/build/
#
#  Copies compiled proof artifacts (WASM + ZKEY + VKEY) from the
#  circuits build directory to the facilitator's expected location,
#  then updates the artifact-manifest.json with file checksums.
#
#  Usage:
#    bash scripts/deploy-artifacts.sh
#    FACILITATOR_DIR=../../apps/facilitator bash scripts/deploy-artifacts.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
FACILITATOR_DIR="${FACILITATOR_DIR:-$ROOT_DIR/../apps/facilitator}"
DEST_DIR="$FACILITATOR_DIR/circuits/build"

# ── Validate source artifacts ────────────────────────────────
WASM_SRC="$BUILD_DIR/UsageBilling_js/UsageBilling.wasm"
ZKEY_SRC="$BUILD_DIR/circuit_final.zkey"
VKEY_SRC="$BUILD_DIR/verification_key.json"

for f in "$WASM_SRC" "$ZKEY_SRC" "$VKEY_SRC"; do
  if [ ! -f "$f" ]; then
    echo "❌ Missing artifact: $f"
    echo "   Run: npm run setup  (from $ROOT_DIR)"
    exit 1
  fi
done

# ── Copy to facilitator ───────────────────────────────────────
echo "📦 Deploying proof artifacts to facilitator..."
mkdir -p "$DEST_DIR/UsageBilling_js"

cp "$WASM_SRC" "$DEST_DIR/UsageBilling_js/UsageBilling.wasm"
cp "$ZKEY_SRC" "$DEST_DIR/circuit_final.zkey"
cp "$VKEY_SRC" "$DEST_DIR/verification_key.json"

echo "   ✅ WASM  → $DEST_DIR/UsageBilling_js/UsageBilling.wasm"
echo "   ✅ ZKEY  → $DEST_DIR/circuit_final.zkey"
echo "   ✅ VKEY  → $DEST_DIR/verification_key.json"

# ── Update artifact manifest with checksums ──────────────────
VERSION="${ARTIFACT_VERSION:-$(date +%Y-%m-%d.1)}"

if command -v sha256sum >/dev/null 2>&1; then
  WASM_SHA=$(sha256sum "$DEST_DIR/UsageBilling_js/UsageBilling.wasm" | awk '{print $1}')
  ZKEY_SHA=$(sha256sum "$DEST_DIR/circuit_final.zkey" | awk '{print $1}')
  VKEY_SHA=$(sha256sum "$DEST_DIR/verification_key.json" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  WASM_SHA=$(shasum -a 256 "$DEST_DIR/UsageBilling_js/UsageBilling.wasm" | awk '{print $1}')
  ZKEY_SHA=$(shasum -a 256 "$DEST_DIR/circuit_final.zkey" | awk '{print $1}')
  VKEY_SHA=$(shasum -a 256 "$DEST_DIR/verification_key.json" | awk '{print $1}')
else
  WASM_SHA="unknown"
  ZKEY_SHA="unknown"
  VKEY_SHA="unknown"
fi

MANIFEST="$DEST_DIR/artifact-manifest.json"
cat > "$MANIFEST" <<EOF
{
  "version": "$VERSION",
  "circuit": "UsageBilling",
  "protocol": "groth16",
  "maxEntries": 128,
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": {
    "wasm": {
      "path": "UsageBilling_js/UsageBilling.wasm",
      "sha256": "$WASM_SHA"
    },
    "zkey": {
      "path": "circuit_final.zkey",
      "sha256": "$ZKEY_SHA"
    },
    "vkey": {
      "path": "verification_key.json",
      "sha256": "$VKEY_SHA"
    }
  }
}
EOF

echo "   ✅ Manifest → $MANIFEST"
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅ Artifacts deployed!                                 ║"
echo "║                                                          ║"
echo "║  Facilitator env vars to set:                           ║"
echo "║  ZK_CIRCUIT_WASM_PATH=$DEST_DIR/UsageBilling_js/UsageBilling.wasm"
echo "║  ZK_CIRCUIT_ZKEY_PATH=$DEST_DIR/circuit_final.zkey"
echo "║  ZK_CIRCUIT_VKEY_PATH=$DEST_DIR/verification_key.json"
echo "║  MEAP_PROOF_ARTIFACT_VERSION=$VERSION"
echo "╚══════════════════════════════════════════════════════════╝"
