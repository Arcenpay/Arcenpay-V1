// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

type ChainConfig = {
  slug: string;
  usdc: string;
  explorerBase: string;
};

const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  11155111: {
    slug: "sepolia",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    explorerBase: "https://sepolia.etherscan.io/address",
  },
  84532: {
    slug: "baseSepolia",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorerBase: "https://sepolia.basescan.org/address",
  },
  8453: {
    slug: "baseMainnet",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorerBase: "https://basescan.org/address",
  },
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);
  const chainConfig = CHAIN_CONFIGS[chainId];

  if (!chainConfig) {
    throw new Error(`Unsupported chain ${chainId}. Add chain config before deploying.`);
  }

  const usdcAddress = process.env.USDC_ADDRESS || chainConfig.usdc;
  if (!ethers.isAddress(usdcAddress)) {
    throw new Error(`Invalid USDC_ADDRESS: ${usdcAddress}`);
  }

  console.log(`\n[deploy] Network=${network.name} chainId=${chainId} deployer=${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[deploy] Balance=${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    throw new Error("Deployer has 0 ETH — cannot deploy.");
  }

  // 1) PlanFactory
  const PlanFactory = await ethers.getContractFactory("PlanFactory");
  const planFactory = await PlanFactory.deploy([usdcAddress]);
  await planFactory.waitForDeployment();
  const planFactoryAddr = await planFactory.getAddress();
  console.log(`[deploy] PlanFactory=${planFactoryAddr}`);

  // 2) FeeCollector
  const FeeCollector = await ethers.getContractFactory("FeeCollector");
  const feeCollector = await FeeCollector.deploy(deployer.address);
  await feeCollector.waitForDeployment();
  const feeCollectorAddr = await feeCollector.getAddress();
  console.log(`[deploy] FeeCollector=${feeCollectorAddr}`);

  // 3) SubscriptionRegistry
  const SubscriptionRegistry = await ethers.getContractFactory("SubscriptionRegistry");
  const registry = await SubscriptionRegistry.deploy(
    "ArcenPay Subscription",
    "ARCENPAY-SUB",
    planFactoryAddr,
  );
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`[deploy] SubscriptionRegistry=${registryAddr}`);

  // 4) SessionVault
  const SessionVault = await ethers.getContractFactory("SessionVault");
  const sessionVault = await SessionVault.deploy();
  await sessionVault.waitForDeployment();
  const sessionVaultAddr = await sessionVault.getAddress();
  console.log(`[deploy] SessionVault=${sessionVaultAddr}`);

  // 5) ZKUsageVerifier
  const ZKUsageVerifier = await ethers.getContractFactory("ZKUsageVerifier");
  const zkVerifier = await ZKUsageVerifier.deploy(
    sessionVaultAddr,
    feeCollectorAddr,
    planFactoryAddr,
  );
  await zkVerifier.waitForDeployment();
  const zkVerifierAddr = await zkVerifier.getAddress();
  console.log(`[deploy] ZKUsageVerifier=${zkVerifierAddr}`);

  // 6) ERC7579AutopayModule
  const AutopayModule = await ethers.getContractFactory("ERC7579AutopayModule");
  const autopayModule = await AutopayModule.deploy(
    planFactoryAddr,
    registryAddr,
    feeCollectorAddr,
    deployer.address,
  );
  await autopayModule.waitForDeployment();
  const autopayModuleAddr = await autopayModule.getAddress();
  console.log(`[deploy] ERC7579AutopayModule=${autopayModuleAddr}`);

  // 7) MirrorRegistry
  const MirrorRegistry = await ethers.getContractFactory("MirrorRegistry");
  const mirrorRegistry = await MirrorRegistry.deploy();
  await mirrorRegistry.waitForDeployment();
  const mirrorRegistryAddr = await mirrorRegistry.getAddress();
  console.log(`[deploy] MirrorRegistry=${mirrorRegistryAddr}`);

  // Post-deploy role wiring
  await (await registry.authorizeBiller(autopayModuleAddr)).wait();
  await (await feeCollector.authorizeCollector(autopayModuleAddr)).wait();
  await (await feeCollector.authorizeCollector(zkVerifierAddr)).wait();
  await (await sessionVault.authorizeSettler(zkVerifierAddr)).wait();
  console.log("[deploy] Role wiring complete");

  const summary = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    contracts: {
      PlanFactory: planFactoryAddr,
      FeeCollector: feeCollectorAddr,
      SubscriptionRegistry: registryAddr,
      SessionVault: sessionVaultAddr,
      ZKUsageVerifier: zkVerifierAddr,
      ERC7579AutopayModule: autopayModuleAddr,
      MirrorRegistry: mirrorRegistryAddr,
    },
    config: {
      USDC: usdcAddress,
      treasury: deployer.address,
    },
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const dateStamp = new Date().toISOString().split("T")[0];
  const datedPath = path.join(deploymentsDir, `${chainConfig.slug}-${dateStamp}.json`);
  const latestPath = path.join(deploymentsDir, `${chainConfig.slug}-latest.json`);
  fs.writeFileSync(datedPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));

  console.log(`[deploy] Deployment file: ${datedPath}`);
  console.log(`[deploy] Latest file: ${latestPath}`);
  console.log(`[deploy] Explorer base: ${chainConfig.explorerBase}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n[deploy] Failed:", error);
    process.exit(1);
  });
