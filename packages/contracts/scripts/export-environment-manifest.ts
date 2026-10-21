import fs from "node:fs";
import path from "node:path";

type DeploymentShape = {
  chainId: number;
  contracts: {
    PlanFactory: string;
    FeeCollector: string;
    SubscriptionRegistry: string;
    SessionVault: string;
    ZKUsageVerifier: string;
    ERC7579AutopayModule: string;
    MirrorRegistry?: string;
  };
};

type ChainConfig = {
  chainId: number;
  chainName: string;
  family: "evm" | "stellar" | "solana";
  isTestnet: boolean;
  status: "production" | "testnet" | "placeholder";
  deploymentFile?: string;
  rpcUrl: string;
  rpcEnv: string;
  subgraphEnv: string;
  facilitatorEnv: string;
  contracts?: Record<string, string>;
  config?: Record<string, unknown>;
};

/**
 * Public chain defaults. Keep in sync with
 * packages/internal-core/src/chain-family.ts (CHAIN_REGISTRY / DEFAULT_SERVICES)
 * and packages/internal-core/src/addresses.ts.
 */
const EVM_CHAINS: ChainConfig[] = [
  {
    chainId: 11155111,
    chainName: "Sepolia",
    family: "evm",
    isTestnet: true,
    status: "testnet",
    deploymentFile: "sepolia-latest.json",
    rpcUrl: "https://rpc.sepolia.org",
    rpcEnv: "SEPOLIA_RPC_URL",
    subgraphEnv: "ARCENPAY_SUBGRAPH_URL_11155111",
    facilitatorEnv: "ARCENPAY_FACILITATOR_URL_11155111",
  },
  {
    chainId: 84532,
    chainName: "Base Sepolia",
    family: "evm",
    isTestnet: true,
    status: "testnet",
    deploymentFile: "baseSepolia-latest.json",
    rpcUrl: "https://sepolia.base.org",
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    subgraphEnv: "ARCENPAY_SUBGRAPH_URL_84532",
    facilitatorEnv: "ARCENPAY_FACILITATOR_URL_84532",
  },
  {
    chainId: 8453,
    chainName: "Base",
    family: "evm",
    isTestnet: false,
    status: "production",
    deploymentFile: "baseMainnet-latest.json",
    rpcUrl: "https://mainnet.base.org",
    rpcEnv: "BASE_MAINNET_RPC_URL",
    subgraphEnv: "ARCENPAY_SUBGRAPH_URL_8453",
    facilitatorEnv: "ARCENPAY_FACILITATOR_URL_8453",
  },
  {
    chainId: 5042002,
    chainName: "Arc Testnet",
    family: "evm",
    isTestnet: true,
    status: "testnet",
    deploymentFile: "arcTestnet-latest.json",
    rpcUrl: "https://rpc.testnet.arc.network",
    rpcEnv: "ARC_TESTNET_RPC_URL",
    subgraphEnv: "ARCENPAY_SUBGRAPH_URL_5042002",
    facilitatorEnv: "ARCENPAY_FACILITATOR_URL_5042002",
  },
  {
    chainId: 968,
    chainName: "BOT Chain Testnet",
    family: "evm",
    isTestnet: true,
    status: "placeholder",
    deploymentFile: "botTestnet-latest.json",
    rpcUrl: "https://rpc.bohr.life",
    rpcEnv: "BOT_TESTNET_RPC_URL",
    subgraphEnv: "ARCENPAY_SUBGRAPH_URL_968",
    facilitatorEnv: "ARCENPAY_FACILITATOR_URL_968",
  },
  {
    chainId: 677,
    chainName: "BOT Chain",
    family: "evm",
    isTestnet: false,
    status: "production",
    deploymentFile: "botMainnet-latest.json",
    // eth_getLogs is disabled on this public endpoint. Production facilitators
    // must override with a getLogs-capable provider.
    rpcUrl: "https://rpc.botchain.ai",
    rpcEnv: "BOT_MAINNET_RPC_URL",
    subgraphEnv: "ARCENPAY_SUBGRAPH_URL_677",
    facilitatorEnv: "ARCENPAY_FACILITATOR_URL_677",
  },
];

const SOLANA_PROGRAM_ID = "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3";

const SOLANA_CONTRACTS = {
  subscriptionRegistry: SOLANA_PROGRAM_ID,
  autopayModule: SOLANA_PROGRAM_ID,
  planFactory: SOLANA_PROGRAM_ID,
  feeCollector: SOLANA_PROGRAM_ID,
  sessionVault: SOLANA_PROGRAM_ID,
  zkUsageVerifier: SOLANA_PROGRAM_ID,
  mirrorRegistry: SOLANA_PROGRAM_ID,
};

const NON_EVM_CHAINS: ChainConfig[] = [
  {
    chainId: 9100000,
    chainName: "Solana Mainnet",
    family: "solana",
    isTestnet: false,
    status: "production",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    rpcEnv: "ARCENPAY_SOLANA_RPC_URL_9100000",
    subgraphEnv: "ARCENPAY_SUBGRAPH_URL_9100000",
    facilitatorEnv: "ARCENPAY_FACILITATOR_URL_9100000",
    contracts: SOLANA_CONTRACTS,
    config: {
      configPda: "Hk8waLk49ssHb4WCKPcGqVN44HNBjF8EvLixJcB53qBk",
      treasury: "3hoVJKNDP9zpHvxizcKGYzZL2ZeTaBTZ2m2p68Wi9Tmv",
      admin: "8rJPx5E5CZkDxvW1WGeyQFQhSDkH55vxx98HKCFwnP34",
      upgradeAuthority: "8rJPx5E5CZkDxvW1WGeyQFQhSDkH55vxx98HKCFwnP34",
      feeBps: 50,
    },
  },
  {
    chainId: 9100001,
    chainName: "Solana Devnet",
    family: "solana",
    isTestnet: true,
    status: "testnet",
    rpcUrl: "https://api.devnet.solana.com",
    rpcEnv: "ARCENPAY_SOLANA_RPC_URL_9100001",
    subgraphEnv: "ARCENPAY_SUBGRAPH_URL_9100001",
    facilitatorEnv: "ARCENPAY_FACILITATOR_URL_9100001",
    contracts: SOLANA_CONTRACTS,
  },
  {
    chainId: 9000001,
    chainName: "Stellar Testnet",
    family: "stellar",
    isTestnet: true,
    status: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    rpcEnv: "STELLAR_RPC_URL_9000001",
    subgraphEnv: "ARCENPAY_SUBGRAPH_URL_9000001",
    facilitatorEnv: "ARCENPAY_FACILITATOR_URL_9000001",
    contracts: {
      subscriptionRegistry: "CBNUA7RLTYRKNQVYOCH4IFMLGTLFL56C5NTS5BEWC2AQGYQEQA4BSOOG",
      autopayModule: "CBIESVR5J3CWARGTUFX5N5B35L6YMW55G7XFLL2H2U3W6ZOH7X6SD657",
      planFactory: "CAF4VS5OMM6DW5ZN5JFJH4U2RJD6DODZYBHNXMTS6RSUMPDO3T4C73S7",
      feeCollector: "CCYRIQZNSWWO7KO6ZBA2AU4GAGQHR44ZQO577JYFVFXAHJW6WNB2XL5A",
      sessionVault: "CCFU6CXODJEGZLKYNSWI4Z5L5CGN7TCVGHZ33IPKPZK6HBXVDZKMVTLY",
      zkUsageVerifier: "CB5UVWDVPATDHJUKLMJXH5FJRNRDPXENXQYOXTT5FYDOXSJGDPUSIDU6",
      mirrorRegistry: "CB5GW6VAYJXMRTPKSEIFAJDT2WID2J5PSDLMAFH5LL7IAVQJNMS2OCO2",
    },
  },
];

function resolveDeployment(fileName: string): DeploymentShape | null {
  const filePath = path.join(__dirname, "..", "deployments", fileName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as DeploymentShape;
}

function main() {
  const chains: Record<number, unknown> = {};

  for (const chain of [...EVM_CHAINS, ...NON_EVM_CHAINS]) {
    let contracts = chain.contracts;

    if (!contracts && chain.deploymentFile) {
      const deployment = resolveDeployment(chain.deploymentFile);
      if (!deployment?.contracts) continue;
      contracts = {
        subscriptionRegistry: deployment.contracts.SubscriptionRegistry,
        autopayModule: deployment.contracts.ERC7579AutopayModule,
        planFactory: deployment.contracts.PlanFactory,
        feeCollector: deployment.contracts.FeeCollector,
        sessionVault: deployment.contracts.SessionVault,
        zkUsageVerifier: deployment.contracts.ZKUsageVerifier,
        mirrorRegistry: deployment.contracts.MirrorRegistry ?? "",
      };
    }

    if (!contracts) continue;

    const rpcUrl = process.env[chain.rpcEnv] || chain.rpcUrl;

    chains[chain.chainId] = {
      chainId: chain.chainId,
      chainName: chain.chainName,
      family: chain.family,
      isTestnet: chain.isTestnet,
      status: chain.status,
      ...(chain.status === "placeholder" ? { placeholder: true } : {}),
      contracts,
      ...(chain.config ? { config: chain.config } : {}),
      services: {
        rpcUrl,
        ...(chain.family === "solana" ? { solanaRpcUrl: rpcUrl } : {}),
        ...(chain.family === "stellar" ? { sorobanRpcUrl: rpcUrl } : {}),
        subgraphUrl: process.env[chain.subgraphEnv] || "",
        facilitatorUrl: process.env[chain.facilitatorEnv] || "",
      },
    };
  }

  const manifest = {
    manifestVersion: "2026-03-09.1",
    generatedAt: new Date().toISOString(),
    notes: {
      serviceUrls:
        "Empty strings mean the endpoint is deployment-specific and is not published in this repository. RPC URLs are public chain defaults.",
      placeholders:
        'Chains with "placeholder": true have deterministic stand-in addresses and are not deployed.',
      productionChains: "BOT Chain Mainnet (677) and Solana Mainnet (9100000) only.",
    },
    chains,
  };

  const outPath = path.join(
    __dirname,
    "..",
    "deployments",
    "environment-manifest.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
}

main();
