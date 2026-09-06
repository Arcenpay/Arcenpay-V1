// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

type DeploymentFile = {
  contracts: {
    SubscriptionRegistry: string;
    ERC7579AutopayModule: string;
  };
};

const CHAIN_SLUG: Record<number, string> = {
  11155111: "sepolia",
  84532: "baseSepolia",
  8453: "baseMainnet",
  5042002: "arcTestnet",
  968: "botTestnet",
  677: "botMainnet",
};

function loadDeployment(chainId: number): DeploymentFile {
  const slug = CHAIN_SLUG[chainId];
  if (!slug) throw new Error(`Unsupported chain ${chainId}`);
  const fileName = process.env.DEPLOYMENT_FILE || `${slug}-latest.json`;
  const filePath = path.join(__dirname, "..", "deployments", fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Deployment file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as DeploymentFile;
}

async function main() {
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);
  const slug = CHAIN_SLUG[chainId];
  if (!slug) throw new Error(`Unsupported chain ${chainId}`);

  const deployment = loadDeployment(chainId);
  const registry = await ethers.getContractAt(
    "SubscriptionRegistry",
    deployment.contracts.SubscriptionRegistry,
  );
  const autopay = await ethers.getContractAt(
    "ERC7579AutopayModule",
    deployment.contracts.ERC7579AutopayModule,
  );

  const totalSupply = Number(await registry.totalSupply());
  const subscriptions: Array<{
    tokenId: string;
    subscriber: string;
    planId: string;
    expiration: string;
  }> = [];
  const accounts = new Set<string>();

  for (let index = 0; index < totalSupply; index += 1) {
    const tokenId = await registry.tokenByIndex(index);
    const subscriber = await registry.ownerOf(tokenId);
    const [planId] = await registry.getPlanFeatures(tokenId);
    const expiration = await registry.expiresAt(tokenId);
    subscriptions.push({
      tokenId: tokenId.toString(),
      subscriber,
      planId: planId.toString(),
      expiration: expiration.toString(),
    });
    accounts.add(subscriber.toLowerCase());
  }

  const extraAccounts = (process.env.EXTRA_MIGRATION_ACCOUNTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const account of extraAccounts) {
    accounts.add(account.toLowerCase());
  }

  const autopayStates: Array<{
    account: string;
    config: {
      merchant: string;
      maxAmount: string;
      token: string;
      interval: number;
      startTime: string;
      planId: string;
      maxTotalAmount: string;
    };
    lastPullTime: string;
    totalPulled: string;
    mirrorDestinationChainId: string;
    accountPaused: boolean;
  }> = [];

  for (const account of accounts) {
    const initialized = await autopay.isInitialized(account);
    if (!initialized) continue;

    const config = await autopay.getConfig(account);
    const lastPullTime = await autopay.lastPullTime(account);
    const totalPulled = await autopay.totalPulled(account);
    const mirrorDestinationChainId = await autopay.mirrorDestinationChainId(account);
    const accountPaused = await autopay.isAccountPaused(account);

    autopayStates.push({
      account,
      config: {
        merchant: config.merchant,
        maxAmount: config.maxAmount.toString(),
        token: config.token,
        interval: Number(config.interval),
        startTime: config.startTime.toString(),
        planId: config.planId.toString(),
        maxTotalAmount: config.maxTotalAmount.toString(),
      },
      lastPullTime: lastPullTime.toString(),
      totalPulled: totalPulled.toString(),
      mirrorDestinationChainId: mirrorDestinationChainId.toString(),
      accountPaused,
    });
  }

  const snapshot = {
    network: network.name,
    chainId,
    sourceDeployment: deployment.contracts,
    createdAt: new Date().toISOString(),
    counts: {
      subscriptions: subscriptions.length,
      autopayStates: autopayStates.length,
    },
    subscriptions,
    autopayStates,
  };

  const snapshotDir = path.join(__dirname, "..", "deployments", "migration");
  fs.mkdirSync(snapshotDir, { recursive: true });
  const filePath = path.join(snapshotDir, `${slug}-snapshot-live-state.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  console.log(`[snapshot-live-state] Wrote ${filePath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[snapshot-live-state] Failed:", error);
    process.exit(1);
  });
