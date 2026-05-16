// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

type ChainConfig = {
  slug: string;
  usdc: string;
  explorerBase: string;
};

type ProxyDeployment = {
  implementation: string;
  proxy: string;
  contract: any;
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
  5042002: {
    slug: "arcTestnet",
    usdc: "0x3600000000000000000000000000000000000000",
    explorerBase: "https://testnet.arcscan.app/address",
  },
};

async function deployUUPSProxy(
  contractName: string,
  initializeArgs: unknown[],
): Promise<ProxyDeployment> {
  const ImplementationFactory = await ethers.getContractFactory(contractName);
  const implementation = await ImplementationFactory.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();

  const ProxyFactory = await ethers.getContractFactory(
    "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
  );
  const initializeData = ImplementationFactory.interface.encodeFunctionData(
    "initialize",
    initializeArgs,
  );
  const proxy = await ProxyFactory.deploy(implementationAddress, initializeData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  const contract = ImplementationFactory.attach(proxyAddress) as any;

  console.log(
    `[deploy] ${contractName}: proxy=${proxyAddress} implementation=${implementationAddress}`,
  );

  return {
    implementation: implementationAddress,
    proxy: proxyAddress,
    contract,
  };
}

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
    throw new Error("Deployer has 0 ETH -- cannot deploy.");
  }

  const planFactory = await deployUUPSProxy("PlanFactory", [
    deployer.address,
    [usdcAddress],
  ]);
  const feeCollector = await deployUUPSProxy("FeeCollector", [
    deployer.address,
    deployer.address,
  ]);
  const subscriptionRegistry = await deployUUPSProxy("SubscriptionRegistry", [
    deployer.address,
    "ArcenPay Subscription",
    "ARCENPAY-SUB",
    planFactory.proxy,
  ]);
  const sessionVault = await deployUUPSProxy("SessionVault", [deployer.address]);
  const zkVerifier = await deployUUPSProxy("ZKUsageVerifier", [
    deployer.address,
    sessionVault.proxy,
    feeCollector.proxy,
    planFactory.proxy,
  ]);
  const autopayModule = await deployUUPSProxy("ERC7579AutopayModule", [
    deployer.address,
    planFactory.proxy,
    subscriptionRegistry.proxy,
    feeCollector.proxy,
    deployer.address,
  ]);
  const mirrorRegistry = await deployUUPSProxy("MirrorRegistry", [deployer.address]);

  await (await subscriptionRegistry.contract.authorizeBiller(autopayModule.proxy)).wait();
  await (await feeCollector.contract.authorizeCollector(autopayModule.proxy)).wait();
  await (await feeCollector.contract.authorizeCollector(zkVerifier.proxy)).wait();
  await (await sessionVault.contract.authorizeSettler(zkVerifier.proxy)).wait();
  console.log("[deploy] Role wiring complete");

  const summary = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    deploymentKind: "uups",
    contracts: {
      PlanFactory: planFactory.proxy,
      FeeCollector: feeCollector.proxy,
      SubscriptionRegistry: subscriptionRegistry.proxy,
      SessionVault: sessionVault.proxy,
      ZKUsageVerifier: zkVerifier.proxy,
      ERC7579AutopayModule: autopayModule.proxy,
      MirrorRegistry: mirrorRegistry.proxy,
    },
    implementations: {
      PlanFactory: planFactory.implementation,
      FeeCollector: feeCollector.implementation,
      SubscriptionRegistry: subscriptionRegistry.implementation,
      SessionVault: sessionVault.implementation,
      ZKUsageVerifier: zkVerifier.implementation,
      ERC7579AutopayModule: autopayModule.implementation,
      MirrorRegistry: mirrorRegistry.implementation,
    },
    config: {
      USDC: usdcAddress,
      treasury: deployer.address,
      owner: deployer.address,
      admin: deployer.address,
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
