#!/usr/bin/env bash
# ============================================================
#  ArcenPay — Stellar (Soroban) Contract Deploy Script
#
#  Deploys all 8 ArcenPay contracts to Stellar testnet in the
#  correct dependency order, initialises each one, and prints
#  the env vars you need to paste into your .env file.
#
#  Prerequisites:
#    - Rust toolchain with wasm target:
#        rustup target add wasm32v1-none
#    - Stellar CLI:
#        cargo install stellar-cli
#    - A funded Stellar testnet account (get 10k XLM via Friendbot):
#        curl "https://friendbot.stellar.org?addr=G_YOUR_ADDRESS"
#
#  Usage:
#    chmod +x scripts/deploy-stellar.sh
#    ./scripts/deploy-stellar.sh G_YOUR_TESTNET_ADDRESS
#    ./scripts/deploy-stellar.sh G_YOUR_TESTNET_ADDRESS --network futurenet
#
#  After running, copy-paste the printed ARCENPAY_CONTRACT_* lines
#  into your .env file, OR the script auto-appends to .env if you
#  pass --write-env.
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

if [ $# -lt 1 ]; then
  echo -e "${RED}Usage: $0 <source-address> [--network futurenet|mainnet] [--write-env]${NC}"
  echo ""
  echo "  source-address  Your Stellar testnet account (G...)."
  echo "  --network       Target network (default: testnet)."
  echo "  --write-env     Append deployed addresses to .env."
  echo ""
  echo "  Before running, fund your testnet account via Friendbot:"
  echo "    curl \"https://friendbot.stellar.org?addr=G_YOUR_ADDRESS\""
  exit 1
fi

SOURCE="$1"
shift

NETWORK="testnet"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SYNTHETIC_CHAIN_ID="9000001"
WRITE_ENV=false

while [ $# -gt 0 ]; do
  case "$1" in
    --network)
      case "$2" in
        mainnet)
          NETWORK="public"
          NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
          SYNTHETIC_CHAIN_ID="9000000"
          ;;
        futurenet)
          NETWORK="futurenet"
          NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"
          SYNTHETIC_CHAIN_ID="9000002"
          ;;
        testnet|*) NETWORK="testnet" ;;
      esac
      shift 2
      ;;
    --write-env) WRITE_ENV=true; shift ;;
    *) echo -e "${RED}Unknown flag: $1${NC}"; exit 1 ;;
  esac
done

if [ "$NETWORK" = "public" ]; then
  NETWORK_LABEL="mainnet"
else
  NETWORK_LABEL="$NETWORK"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/packages/stellar-contracts"
TARGET_DIR="$CONTRACTS_DIR/target/wasm32v1-none/release"
RPC_URL=""

case "$NETWORK" in
  testnet)    RPC_URL="https://soroban-testnet.stellar.org" ;;
  futurenet)  RPC_URL="https://rpc-futurenet.stellar.org" ;;
  public)
    echo -e "${YELLOW}[!] Stellar mainnet has no SDF-hosted Soroban RPC.${NC}"
    echo "    Set STELLAR_RPC_URL env var to your provider and pass --network mainnet."
    exit 1
    ;;
esac

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  ArcenPay Stellar Contract Deploy — ${NETWORK_LABEL} (chainId ${SYNTHETIC_CHAIN_ID})${NC}"
echo -e "${CYAN}  Source account: ${SOURCE}${NC}"
echo -e "${CYAN}  RPC: ${RPC_URL}${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════════${NC}"
echo ""

# ── Build all contracts ────────────────────────────────────────────────────
echo -e "${YELLOW}[1/3] Building contracts for wasm32v1-none...${NC}"
cd "$CONTRACTS_DIR"
cargo build --release --target wasm32v1-none 2>&1 | tail -5
echo -e "${GREEN}  Build complete.${NC}"
echo ""

# ── Deploy function ────────────────────────────────────────────────────────
declare -A DEPLOYED

deploy_contract() {
  local name="$1"
  local wasm_name="$2"
  shift 2
  local constructor_args=("$@")

  local wasm_path="$TARGET_DIR/${wasm_name}.wasm"
  if [ ! -f "$wasm_path" ]; then
    echo -e "${RED}  ✗ Wasm not found: $wasm_path${NC}"
    return 1
  fi

  echo -e "${YELLOW}  Deploying ${name}...${NC}"
  local contract_id
  contract_id=$(stellar contract deploy \
    --wasm "$wasm_path" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" 2>&1)

  if [ $? -ne 0 ]; then
    echo -e "${RED}  ✗ Deploy failed: $contract_id${NC}"
    return 1
  fi

  contract_id=$(echo "$contract_id" | grep -oE 'C[A-Z0-9]{55}' | tail -1)
  echo -e "${GREEN}  ✓ Deployed: ${contract_id}${NC}"

  # Initialise if constructor args provided
  if [ ${#constructor_args[@]} -gt 0 ]; then
    echo -e "${YELLOW}  Initialising ${name}...${NC}"
    stellar contract invoke \
      --id "$contract_id" \
      --source "$SOURCE" \
      --network "$NETWORK" \
      --rpc-url "$RPC_URL" \
      -- \
      __constructor "${constructor_args[@]}" > /dev/null 2>&1
    echo -e "${GREEN}  ✓ Initialised${NC}"
  fi

  DEPLOYED["$name"]="$contract_id"
}

# ── Deploy in dependency order ─────────────────────────────────────────────
echo -e "${YELLOW}[2/3] Deploying contracts (dependency order)...${NC}"
echo ""

# 1. flag-registry (no deps)
deploy_contract "flagRegistry" "arcenpay_flag_registry" \
  --admin "$SOURCE"

# 2. plan-factory (no deps; approved_tokens = your source address so you
#    can create plans immediately — call approve_token() post-deploy to
#    add more tokens like USDC)
deploy_contract "planFactory" "arcenpay_plan_factory" \
  --admin "$SOURCE" \
  --approved_tokens "$SOURCE"

# 3. fee-collector (no deps)
deploy_contract "feeCollector" "arcenpay_fee_collector" \
  --admin "$SOURCE" \
  --treasury "$SOURCE"

# 4. subscription-registry (depends on plan-factory)
deploy_contract "subscriptionRegistry" "arcenpay_subscription_registry" \
  --admin "$SOURCE" \
  --plan_factory "${DEPLOYED[planFactory]}"

# 5. session-vault (no deps)
deploy_contract "sessionVault" "arcenpay_session_vault" \
  --admin "$SOURCE"

# 6. autopay-account (depends on plan-factory, subscription-registry, fee-collector)
deploy_contract "autopayModule" "arcenpay_autopay_account" \
  --admin "$SOURCE" \
  --operator_admin "$SOURCE" \
  --plan_factory "${DEPLOYED[planFactory]}" \
  --subscription_registry "${DEPLOYED[subscriptionRegistry]}" \
  --fee_collector "${DEPLOYED[feeCollector]}"

# 7. usage-verifier (depends on session-vault, fee-collector, plan-factory)
deploy_contract "zkUsageVerifier" "arcenpay_usage_verifier" \
  --admin "$SOURCE" \
  --session_vault "${DEPLOYED[sessionVault]}" \
  --fee_collector "${DEPLOYED[feeCollector]}" \
  --plan_factory "${DEPLOYED[planFactory]}"

# 8. mirror-registry (no deps, multi-sig bridge with threshold=1 for dev)
deploy_contract "mirrorRegistry" "arcenpay_mirror_registry" \
  --admin "$SOURCE" \
  --threshold 1

echo ""

# ── Environment variable output ─────────────────────────────────────────────
echo -e "${YELLOW}[3/3] Environment variables${NC}"
echo ""
echo -e "${CYAN}  Copy these into your .env file:${NC}"
echo ""

cat <<ENV
# ── Stellar ${NETWORK_LABEL} (chainId ${SYNTHETIC_CHAIN_ID}) ──
ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_subscriptionRegistry=${DEPLOYED[subscriptionRegistry]}
ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_autopayModule=${DEPLOYED[autopayModule]}
ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_planFactory=${DEPLOYED[planFactory]}
ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_feeCollector=${DEPLOYED[feeCollector]}
ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_sessionVault=${DEPLOYED[sessionVault]}
ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_zkUsageVerifier=${DEPLOYED[zkUsageVerifier]}
ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_mirrorRegistry=${DEPLOYED[mirrorRegistry]}
STELLAR_RPC_URL_${SYNTHETIC_CHAIN_ID}=${RPC_URL}
ENV

echo ""

if [ "$WRITE_ENV" = true ]; then
  ENV_FILE="$REPO_ROOT/.env"
  echo "# ── Stellar ${NETWORK_LABEL} (chainId ${SYNTHETIC_CHAIN_ID}) ──" >> "$ENV_FILE"
  echo "ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_subscriptionRegistry=${DEPLOYED[subscriptionRegistry]}" >> "$ENV_FILE"
  echo "ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_autopayModule=${DEPLOYED[autopayModule]}" >> "$ENV_FILE"
  echo "ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_planFactory=${DEPLOYED[planFactory]}" >> "$ENV_FILE"
  echo "ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_feeCollector=${DEPLOYED[feeCollector]}" >> "$ENV_FILE"
  echo "ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_sessionVault=${DEPLOYED[sessionVault]}" >> "$ENV_FILE"
  echo "ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_zkUsageVerifier=${DEPLOYED[zkUsageVerifier]}" >> "$ENV_FILE"
  echo "ARCENPAY_CONTRACT_${SYNTHETIC_CHAIN_ID}_mirrorRegistry=${DEPLOYED[mirrorRegistry]}" >> "$ENV_FILE"
  echo "STELLAR_RPC_URL_${SYNTHETIC_CHAIN_ID}=${RPC_URL}" >> "$ENV_FILE"
  echo ""
  echo -e "${GREEN}  ✓ Appended to ${ENV_FILE}${NC}"
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deploy complete. Contract addresses for chainId ${SYNTHETIC_CHAIN_ID} printed above.${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${NC}"
