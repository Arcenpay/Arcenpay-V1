#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_cmd() {
  local cmd="$1"
  local install_hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ Missing required binary: $cmd"
    echo "   $install_hint"
    exit 1
  fi
}

mode="${1:-all}"

if [[ "$mode" == "circom" || "$mode" == "all" ]]; then
  require_cmd "circom" "Install Circom: https://docs.circom.io/getting-started/installation/"
fi

if [[ "$mode" == "snarkjs" || "$mode" == "all" ]]; then
  if ! command -v snarkjs >/dev/null 2>&1; then
    if [[ ! -x "$ROOT_DIR/node_modules/.bin/snarkjs" ]]; then
      echo "❌ Missing snarkjs CLI."
      echo "   Run: npm --prefix circuits install"
      exit 1
    fi
  fi
fi
