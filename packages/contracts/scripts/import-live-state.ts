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

type SnapshotFile = {
  subscriptions: Array<{
    tokenId: string;
    subscriber: string;
    planId: string;
    expiration: string;
  }>;
  autopayStates: Array<{
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
  }>;
};

const CHAIN_SLUG: Record<number, string> = {
  11155111: "sepolia",
  84532: "baseSepolia",
  8453: "baseMainnet",
  5042002: "arcTestnet",
};

function loadJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

async function main() {
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);
  const slug = CHAIN_SLUG[chainId];
  if (!slug) throw new Error(`Unsupported chain ${chainId}`);

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFilePath = path.join(
    deploymentsDir,
    process.env.NEW_DEPLOYMENT_FILE || `${slug}-latest.json`,
  );
  const snapshotFilePath = path.join(
    deploymentsDir,
    "migration",
    process.env.MIGRATION_SNAPSHOT_FILE || `${slug}-snapshot-live-state.json`,
  );

  const deployment = loadJson<DeploymentFile>(deploymentFilePath);
  const snapshot = loadJson<SnapshotFile>(snapshotFilePath);

  const registry = await ethers.getContractAt(
    "SubscriptionRegistry",
    deployment.contracts.SubscriptionRegistry,
  );
  const autopay = await ethers.getContractAt(
    "ERC7579AutopayModule",
    deployment.contracts.ERC7579AutopayModule,
  );

  console.log(
    `[import-live-state] Network=${network.name} importing ${snapshot.subscriptions.length} subscriptions and ${snapshot.autopayStates.length} autopay states`,
  );

  for (const subscription of snapshot.subscriptions) {
    const tx = await registry.importSubscription(
      subscription.subscriber,
      BigInt(subscription.tokenId),
      BigInt(subscription.planId),
      BigInt(subscription.expiration),
    );
    await tx.wait();
  }

  for (const state of snapshot.autopayStates) {
    const tx = await autopay.importAccountState(
      state.account,
      {
        merchant: state.config.merchant,
        maxAmount: BigInt(state.config.maxAmount),
        token: state.config.token,
        interval: state.config.interval,
        startTime: BigInt(state.config.startTime),
        planId: BigInt(state.config.planId),
        maxTotalAmount: BigInt(state.config.maxTotalAmount),
      },
      BigInt(state.lastPullTime),
      BigInt(state.totalPulled),
      BigInt(state.mirrorDestinationChainId),
      state.accountPaused,
    );
    await tx.wait();
  }

  if (process.env.FINALIZE_MIGRATION === "true") {
    await (await registry.finalizeMigration()).wait();
    await (await autopay.finalizeMigration()).wait();
    console.log("[import-live-state] Migration finalized on target contracts");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[import-live-state] Failed:", error);
    process.exit(1);
  });
