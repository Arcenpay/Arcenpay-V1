#!/usr/bin/env bash
#
# Runs one facilitator process per chain, side by side.
#
# Why one process per chain: `server.ts` resolves `chainFamily` once from
# CHAIN_ID at boot and arms exactly ONE chain adapter (event listener, keeper /
# renewal driver, settlement writer). "All chains" therefore means "all
# processes". Each process prints its own banner with its own chain; every
# process also lists the whole deployment's chains (via FACILITATOR_CHAINS).
#
# IMPORTANT: launched from the REPO ROOT so the root .env is loaded. The server
# reads env files relative to process.cwd(), so running from apps/facilitator
# would skip the root .env.
#
# Defaults: Arc Testnet (EVM) :3402 · Solana devnet :3403 ·
#           Base Sepolia (EVM) :3404 · Stellar testnet :3405
# Override:  FACILITATOR_CHAINS="5042002:3402,9100001:3403,84532:3404,9000001:3405"
#
set -euo pipefail

cd "$(dirname "$0")/.."

DEFAULT_CHAINS="5042002:3402,9100001:3403,84532:3404,9000001:3405"
CHAINS="${FACILITATOR_CHAINS:-$DEFAULT_CHAINS}"

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup INT TERM EXIT

IFS=',' read -r -a entries <<< "$CHAINS"
for entry in "${entries[@]}"; do
  chain="${entry%%:*}"
  port="${entry##*:}"
  echo "[facilitators] chain=$chain port=$port"
  # FACILITATOR_CHAINS is passed to every child so each banner can enumerate the
  # whole deployment (and mark which chain it owns).
  CHAIN_ID="$chain" PORT="$port" FACILITATOR_CHAINS="$CHAINS" \
    npx tsx apps/facilitator/src/server.ts &
  pids+=($!)
done

echo "[facilitators] ${#entries[@]} process(es) started: ${CHAINS}"
echo "  Billing events flow facilitator → backend (POST /api/v1/billing/events),"
echo "  so no per-chain FACILITATOR_BASE_URL is needed. Settlement keys are"
echo "  per-chain: SETTLEMENT_PRIVATE_KEY_<chainId>."

wait
