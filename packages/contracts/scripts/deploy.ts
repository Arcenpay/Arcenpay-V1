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
  // BOT Chain has NO canonical USDC — this is the official bridged USDT
  // (dev-docs.botchain.ai/docs/Bridge/contract-addresses). The `usdc` field
  // name is generic/legacy; it's just the funding/quote token PlanFactory
  // is initialized with.
  968: {
    slug: "botTestnet",
    usdc: "0x75edC9335175Fc0552D51D48439F229c10420fe3",
    explorerBase: "https://scan.botchain.ai/address",
  },
  677: {
    slug: "botMainnet",
    usdc: "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
    explorerBase: "https://scan.botchain.ai/address",
  },
};

async function getOrDeployUUPSProxy(
  contractName: string,
  initializeArgs: unknown[],
  existingProxy?: string,
  existingImplementation?: string,
  onSave?: (proxy: string, implementation: string) => void,
): Promise<ProxyDeployment> {
  const ImplementationFactory = await ethers.getContractFactory(contractName);

  if (existingProxy && ethers.isAddress(existingProxy)) {
    const code = await ethers.provider.getCode(existingProxy);
    if (code && code !== "0x" && code.length > 2) {
      console.log(
        `[deploy] Reusing existing ${contractName}: proxy=${existingProxy} implementation=${existingImplementation || "verified"}`,
      );
      const contract = ImplementationFactory.attach(existingProxy) as any;
      return {
        implementation: existingImplementation || "",
        proxy: existingProxy,
        contract,
      };
    }
  }

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

  if (onSave) {
    onSave(proxyAddress, implementationAddress);
  }

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
  console.log(`[deploy] Balance=${ethers.formatEther(balance)} gas-tokens`);
  if (balance === 0n) {
    throw new Error("Deployer has 0 balance -- cannot deploy.");
  }

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const dateStamp = new Date().toISOString().split("T")[0];
  const datedPath = path.join(deploymentsDir, `${chainConfig.slug}-${dateStamp}.json`);
  const latestPath = path.join(deploymentsDir, `${chainConfig.slug}-latest.json`);

  let existingDeployment: any = {};
  if (fs.existsSync(latestPath)) {
    try {
      existingDeployment = JSON.parse(fs.readFileSync(latestPath, "utf8"));
      console.log(`[deploy] Loaded existing checkpoint from ${latestPath}`);
    } catch {
      existingDeployment = {};
    }
  }

  const contracts: Record<string, string> = { ...(existingDeployment.contracts || {}) };
  const implementations: Record<string, string> = { ...(existingDeployment.implementations || {}) };

  function saveCheckpoint(name: string, proxy: string, impl: string) {
    contracts[name] = proxy;
    implementations[name] = impl;
    const checkpoint = {
      network: network.name,
      chainId,
      deployer: deployer.address,
      deploymentKind: "uups",
      contracts,
      implementations,
      config: {
        USDC: usdcAddress,
        treasury: deployer.address,
        owner: deployer.address,
        admin: deployer.address,
      },
      deployedAt: new Date().toISOString(),
    };
    fs.writeFileSync(latestPath, JSON.stringify(checkpoint, null, 2));
    fs.writeFileSync(datedPath, JSON.stringify(checkpoint, null, 2));
    console.log(`[deploy] Checkpoint updated: ${name} -> proxy=${proxy}`);
  }

  const planFactory = await getOrDeployUUPSProxy(
    "PlanFactory",
    [deployer.address, [usdcAddress]],
    contracts.PlanFactory,
    implementations.PlanFactory,
    (proxy, impl) => saveCheckpoint("PlanFactory", proxy, impl),
  );

  const feeCollector = await getOrDeployUUPSProxy(
    "FeeCollector",
    [deployer.address, deployer.address],
    contracts.FeeCollector,
    implementations.FeeCollector,
    (proxy, impl) => saveCheckpoint("FeeCollector", proxy, impl),
  );

  const subscriptionRegistry = await getOrDeployUUPSProxy(
    "SubscriptionRegistry",
    [deployer.address, "ArcenPay Subscription", "ARCENPAY-SUB", planFactory.proxy],
    contracts.SubscriptionRegistry,
    implementations.SubscriptionRegistry,
    (proxy, impl) => saveCheckpoint("SubscriptionRegistry", proxy, impl),
  );

  const sessionVault = await getOrDeployUUPSProxy(
    "SessionVault",
    [deployer.address],
    contracts.SessionVault,
    implementations.SessionVault,
    (proxy, impl) => saveCheckpoint("SessionVault", proxy, impl),
  );

  const zkVerifier = await getOrDeployUUPSProxy(
    "ZKUsageVerifier",
    [deployer.address, sessionVault.proxy, feeCollector.proxy, planFactory.proxy],
    contracts.ZKUsageVerifier,
    implementations.ZKUsageVerifier,
    (proxy, impl) => saveCheckpoint("ZKUsageVerifier", proxy, impl),
  );

  const autopayModule = await getOrDeployUUPSProxy(
    "ERC7579AutopayModule",
    [deployer.address, planFactory.proxy, subscriptionRegistry.proxy, feeCollector.proxy, deployer.address],
    contracts.ERC7579AutopayModule,
    implementations.ERC7579AutopayModule,
    (proxy, impl) => saveCheckpoint("ERC7579AutopayModule", proxy, impl),
  );

  const mirrorRegistry = await getOrDeployUUPSProxy(
    "MirrorRegistry",
    [deployer.address],
    contracts.MirrorRegistry,
    implementations.MirrorRegistry,
    (proxy, impl) => saveCheckpoint("MirrorRegistry", proxy, impl),
  );

  // Role wiring (idempotent checks before submitting txs)
  const isBiller = await subscriptionRegistry.contract.authorizedBillers(autopayModule.proxy);
  if (!isBiller) {
    console.log(`[deploy] Authorizing biller ${autopayModule.proxy} on SubscriptionRegistry...`);
    await (await subscriptionRegistry.contract.authorizeBiller(autopayModule.proxy)).wait();
  } else {
    console.log(`[deploy] Biller already authorized on SubscriptionRegistry`);
  }

  const isCollectorAutopay = await feeCollector.contract.authorizedCollectors(autopayModule.proxy);
  if (!isCollectorAutopay) {
    console.log(`[deploy] Authorizing collector ${autopayModule.proxy} on FeeCollector...`);
    await (await feeCollector.contract.authorizeCollector(autopayModule.proxy)).wait();
  } else {
    console.log(`[deploy] Collector (Autopay) already authorized on FeeCollector`);
  }

  const isCollectorZk = await feeCollector.contract.authorizedCollectors(zkVerifier.proxy);
  if (!isCollectorZk) {
    console.log(`[deploy] Authorizing collector ${zkVerifier.proxy} on FeeCollector...`);
    await (await feeCollector.contract.authorizeCollector(zkVerifier.proxy)).wait();
  } else {
    console.log(`[deploy] Collector (ZKVerifier) already authorized on FeeCollector`);
  }

  const isSettler = await sessionVault.contract.authorizedSettlers(zkVerifier.proxy);
  if (!isSettler) {
    console.log(`[deploy] Authorizing settler ${zkVerifier.proxy} on SessionVault...`);
    await (await sessionVault.contract.authorizeSettler(zkVerifier.proxy)).wait();
  } else {
    console.log(`[deploy] Settler already authorized on SessionVault`);
  }

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
