// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

type ContinueDeployment = {
  contracts: {
    PlanFactory: string;
    FeeCollector: string;
    SubscriptionRegistry: string;
    SessionVault: string;
    ZKUsageVerifier?: string;
    ERC7579AutopayModule?: string;
    MirrorRegistry?: string;
  };
  config?: { USDC?: string; treasury?: string };
};

const CHAIN_SLUG: Record<number, string> = {
  11155111: "sepolia",
  84532: "baseSepolia",
  8453: "baseMainnet",
  5042002: "arcTestnet",
  968: "botTestnet",
  677: "botMainnet",
};

function loadBaseDeployment(chainId: number): ContinueDeployment {
  const slug = CHAIN_SLUG[chainId];
  if (!slug) {
    throw new Error(`Unsupported chain ${chainId}`);
  }
  const fileName = process.env.DEPLOYMENT_FILE || `${slug}-latest.json`;
  const filePath = path.join(__dirname, "..", "deployments", fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Deployment file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ContinueDeployment;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);
  const slug = CHAIN_SLUG[chainId];
  if (!slug) {
    throw new Error(`Unsupported chain ${chainId}`);
  }

  const base = loadBaseDeployment(chainId);
  const required = [
    base.contracts.PlanFactory,
    base.contracts.FeeCollector,
    base.contracts.SubscriptionRegistry,
    base.contracts.SessionVault,
  ];
  if (required.some((addr) => !ethers.isAddress(addr))) {
    throw new Error("Deployment file is missing required contract addresses.");
  }

  console.log(`[deploy-continue] Network=${network.name} chainId=${chainId}`);
  console.log(`[deploy-continue] Signer=${deployer.address}`);

  // 5) ZKUsageVerifier
  const ZKUsageVerifier = await ethers.getContractFactory("ZKUsageVerifier");
  const zkVerifier = await ZKUsageVerifier.deploy(
    base.contracts.SessionVault,
    base.contracts.FeeCollector,
    base.contracts.PlanFactory,
  );
  await zkVerifier.waitForDeployment();
  const zkVerifierAddr = await zkVerifier.getAddress();

  // 6) ERC7579AutopayModule
  const AutopayModule = await ethers.getContractFactory("ERC7579AutopayModule");
  const autopayModule = await AutopayModule.deploy(
    base.contracts.PlanFactory,
    base.contracts.SubscriptionRegistry,
    base.contracts.FeeCollector,
    deployer.address,
  );
  await autopayModule.waitForDeployment();
  const autopayModuleAddr = await autopayModule.getAddress();

  // 7) MirrorRegistry
  const MirrorRegistry = await ethers.getContractFactory("MirrorRegistry");
  const mirrorRegistry = await MirrorRegistry.deploy();
  await mirrorRegistry.waitForDeployment();
  const mirrorRegistryAddr = await mirrorRegistry.getAddress();

  const registry = await ethers.getContractAt("SubscriptionRegistry", base.contracts.SubscriptionRegistry);
  const feeCollector = await ethers.getContractAt("FeeCollector", base.contracts.FeeCollector);
  const sessionVault = await ethers.getContractAt("SessionVault", base.contracts.SessionVault);

  await (await registry.authorizeBiller(autopayModuleAddr)).wait();
  await (await feeCollector.authorizeCollector(autopayModuleAddr)).wait();
  await (await feeCollector.authorizeCollector(zkVerifierAddr)).wait();
  await (await sessionVault.authorizeSettler(zkVerifierAddr)).wait();

  const summary = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    contracts: {
      ...base.contracts,
      ZKUsageVerifier: zkVerifierAddr,
      ERC7579AutopayModule: autopayModuleAddr,
      MirrorRegistry: mirrorRegistryAddr,
    },
    config: base.config || {},
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const dateStamp = new Date().toISOString().split("T")[0];
  const datedPath = path.join(deploymentsDir, `${slug}-${dateStamp}.json`);
  const latestPath = path.join(deploymentsDir, `${slug}-latest.json`);
  fs.writeFileSync(datedPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));

  console.log(`[deploy-continue] ZKUsageVerifier=${zkVerifierAddr}`);
  console.log(`[deploy-continue] ERC7579AutopayModule=${autopayModuleAddr}`);
  console.log(`[deploy-continue] MirrorRegistry=${mirrorRegistryAddr}`);
  console.log(`[deploy-continue] Wrote ${latestPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[deploy-continue] Failed:", error);
    process.exit(1);
  });
