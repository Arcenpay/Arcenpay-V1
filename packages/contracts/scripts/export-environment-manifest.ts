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
  isTestnet: boolean;
  deploymentFile: string;
  rpcEnv: string;
  subgraphEnv: string;
  facilitatorEnv: string;
};

const CHAINS: ChainConfig[] = [
  {
    chainId: 11155111,
    chainName: "Sepolia",
    isTestnet: true,
    deploymentFile: "sepolia-latest.json",
    rpcEnv: "SEPOLIA_RPC_URL",
    subgraphEnv: "MEAP_SUBGRAPH_URL_11155111",
    facilitatorEnv: "MEAP_FACILITATOR_URL_11155111",
  },
  {
    chainId: 84532,
    chainName: "Base Sepolia",
    isTestnet: true,
    deploymentFile: "baseSepolia-latest.json",
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    subgraphEnv: "MEAP_SUBGRAPH_URL_84532",
    facilitatorEnv: "MEAP_FACILITATOR_URL_84532",
  },
  {
    chainId: 8453,
    chainName: "Base",
    isTestnet: false,
    deploymentFile: "baseMainnet-latest.json",
    rpcEnv: "BASE_MAINNET_RPC_URL",
    subgraphEnv: "MEAP_SUBGRAPH_URL_8453",
    facilitatorEnv: "MEAP_FACILITATOR_URL_8453",
  },
];

function resolveDeployment(fileName: string): DeploymentShape | null {
  const filePath = path.join(__dirname, "..", "deployments", fileName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as DeploymentShape;
}

function main() {
  const chains: Record<number, unknown> = {};

  for (const chain of CHAINS) {
    const deployment = resolveDeployment(chain.deploymentFile);
    const contracts = deployment?.contracts;
    if (!contracts) continue;

    chains[chain.chainId] = {
      chainId: chain.chainId,
      chainName: chain.chainName,
      isTestnet: chain.isTestnet,
      contracts: {
        subscriptionRegistry: contracts.SubscriptionRegistry,
        autopayModule: contracts.ERC7579AutopayModule,
        planFactory: contracts.PlanFactory,
        feeCollector: contracts.FeeCollector,
        sessionVault: contracts.SessionVault,
        zkUsageVerifier: contracts.ZKUsageVerifier,
        mirrorRegistry: contracts.MirrorRegistry,
      },
      services: {
        rpcUrl: process.env[chain.rpcEnv] || "",
        subgraphUrl: process.env[chain.subgraphEnv] || "",
        facilitatorUrl: process.env[chain.facilitatorEnv] || "",
      },
    };
  }

  const manifest = {
    manifestVersion: "2026-03-09.1",
    generatedAt: new Date().toISOString(),
    chains,
  };

  const outPath = path.join(
    __dirname,
    "..",
    "deployments",
    "environment-manifest.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${outPath}`);
}

main();

