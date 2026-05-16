// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

type DeploymentShape = {
  network: string;
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
  config?: {
    USDC?: string;
  };
};

const ERC20_ABI = [
  "function approve(address spender, uint256 value) external returns (bool)",
];

function deploymentFileFor(chainId: number): string {
  if (chainId === 11155111) return "sepolia-latest.json";
  if (chainId === 84532) return "baseSepolia-latest.json";
  if (chainId === 8453) return "baseMainnet-latest.json";
  if (chainId === 5042002) return "arcTestnet-latest.json";
  throw new Error(`No deployment file mapping for chainId=${chainId}`);
}

function loadDeployment(chainId: number): DeploymentShape {
  const fileName = process.env.SMOKE_DEPLOYMENT_FILE || deploymentFileFor(chainId);
  const fullPath = path.join(__dirname, "..", "deployments", fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Deployment file not found: ${fullPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as DeploymentShape;
}

async function assertContractCode(label: string, address: string): Promise<void> {
  const code = await ethers.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(`No contract code found for ${label} at ${address}`);
  }
}

async function waitForTimestampAfter(targetTimestamp: bigint, timeoutMs = 30_000): Promise<bigint> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const latestBlock = await ethers.provider.getBlock("latest");
    const latestTimestamp = BigInt(latestBlock?.timestamp ?? 0);
    if (latestTimestamp > targetTimestamp) {
      return latestTimestamp;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `Timed out waiting for chain timestamp to exceed ${targetTimestamp.toString()} after ${timeoutMs}ms.`,
  );
}

async function waitForTransactionReceipt(txHash: string, timeoutMs = 60_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (receipt) {
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for transaction receipt ${txHash} after ${timeoutMs}ms.`);
}

async function main() {
  const [signer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);
  const deployment = loadDeployment(chainId);

  const usdcAddress = process.env.SMOKE_USDC_ADDRESS || deployment.config?.USDC;
  if (!usdcAddress || !ethers.isAddress(usdcAddress)) {
    throw new Error("USDC address missing. Set SMOKE_USDC_ADDRESS or config.USDC in deployment file.");
  }

  const duration = Number(process.env.SMOKE_DURATION_SECONDS || 2_592_000);
  const renewalExtension = Number(process.env.SMOKE_RENEW_EXTENSION_SECONDS || 86_400);
  const planPrice = BigInt(process.env.SMOKE_PLAN_PRICE_ATOMIC || "1000000");
  const subscriberAddress =
    process.env.SMOKE_SUBSCRIBER_ADDRESS && ethers.isAddress(process.env.SMOKE_SUBSCRIBER_ADDRESS)
      ? process.env.SMOKE_SUBSCRIBER_ADDRESS
      : ethers.Wallet.createRandom().address;

  const planFactory = await ethers.getContractAt(
    "PlanFactory",
    deployment.contracts.PlanFactory,
    signer,
  );
  const registry = await ethers.getContractAt(
    "SubscriptionRegistry",
    deployment.contracts.SubscriptionRegistry,
    signer,
  );
  const sessionVault = await ethers.getContractAt(
    "SessionVault",
    deployment.contracts.SessionVault,
    signer,
  );

  await assertContractCode("PlanFactory", deployment.contracts.PlanFactory);
  await assertContractCode("SubscriptionRegistry", deployment.contracts.SubscriptionRegistry);
  await assertContractCode("SessionVault", deployment.contracts.SessionVault);
  await assertContractCode("ZKUsageVerifier", deployment.contracts.ZKUsageVerifier);

  const summary: Record<string, unknown> = {
    network: network.name,
    chainId,
    signer: signer.address,
    subscriberAddress,
    startedAt: new Date().toISOString(),
    checks: [] as string[],
    warnings: [] as string[],
  };

  const checks = summary.checks as string[];
  const warnings = summary.warnings as string[];

  // 1) Self-serve provider onboarding + plan create
  const planName = `smoke-${Date.now()}`;
  const createPlanTx = await planFactory.createPlan(
    planName,
    "smoke",
    planPrice,
    duration,
    usdcAddress,
    "ipfs://arcenpay/smoke",
  );
  await createPlanTx.wait();
  const isProvider = await planFactory.isProvider(signer.address);
  if (!isProvider) {
    throw new Error("Signer should be auto-registered as provider after createPlan.");
  }
  checks.push("Signer is registered as provider");
  const providerPlans = (await planFactory.getProviderPlans(signer.address)) as bigint[];
  const planId = providerPlans[providerPlans.length - 1];
  checks.push(`Created plan ${planId.toString()}`);

  // 2) Subscription mint/renew/cancel
  const signerAuthorizedBiller = await registry.authorizedBillers(signer.address);
  if (!signerAuthorizedBiller) {
    const tx = await registry.authorizeBiller(signer.address);
    await tx.wait();
    checks.push("Authorized signer as biller");
  }

  const previewTokenId = (await registry.mint.staticCall(
    subscriberAddress,
    planId,
    duration,
  ).catch(() => 0n)) as bigint;
  const mintTx = await registry.mint(subscriberAddress, planId, duration);
  await mintTx.wait();
  const tokenId =
    previewTokenId || ((await registry.getWalletSubscription(subscriberAddress)) as bigint);
  if (tokenId <= 0n) {
    throw new Error("Mint succeeded but no subscription token could be resolved for the subscriber.");
  }
  checks.push(`Minted subscription token ${tokenId.toString()}`);

  const renewTx = await registry.renew(tokenId, renewalExtension);
  await renewTx.wait();
  checks.push("Renewed subscription");

  const cancelTx = await registry.cancel(tokenId);
  await cancelTx.wait();
  const cancelReceipt = await waitForTransactionReceipt(cancelTx.hash);
  const cancelledExpiry = (await registry.expiresAt(tokenId)) as bigint;
  const cancelBlock = cancelReceipt?.blockNumber
    ? await ethers.provider.getBlock(cancelReceipt.blockNumber)
    : null;
  const cancelBlockTimestamp = BigInt(cancelBlock?.timestamp ?? 0);
  const cancelledByExpiry = cancelledExpiry <= cancelBlockTimestamp;
  if (!cancelledByExpiry) {
    throw new Error(
      `Cancellation verification failed for token ${tokenId.toString()} ` +
        `(expiry=${cancelledExpiry.toString()} cancelBlock=${cancelBlockTimestamp.toString()}).`,
    );
  }
  let finalityTimestamp = cancelBlockTimestamp;
  let isValidAfterCancel = await registry.isValid(tokenId);
  if (isValidAfterCancel) {
    try {
      finalityTimestamp = await waitForTimestampAfter(cancelledExpiry);
      isValidAfterCancel = await registry.isValid(tokenId);
    } catch {
      warnings.push(
        `Cancellation for token ${tokenId.toString()} was verified at block ${String(cancelReceipt?.blockNumber ?? "unknown")}, ` +
          "but the network did not advance quickly enough to confirm post-cancel validity from a later block.",
      );
    }
  }
  if (isValidAfterCancel && finalityTimestamp > cancelledExpiry) {
    throw new Error(
      `Cancellation finality check failed for token ${tokenId.toString()} ` +
        `(expiry=${cancelledExpiry.toString()} latest=${finalityTimestamp.toString()} isValid=${String(isValidAfterCancel)}).`,
    );
  }
  checks.push(
    `Cancelled subscription (cancelled=${String(cancelledByExpiry)} isValid=${String(isValidAfterCancel)})`,
  );

  // 3) Optional session lifecycle (fund -> topup -> settle -> withdraw)
  const sessionDepositRaw = process.env.SMOKE_SESSION_DEPOSIT_ATOMIC || "";
  if (sessionDepositRaw) {
    const sessionDeposit = BigInt(sessionDepositRaw);
    const topUpAmount = sessionDeposit / 2n;
    const settleAmount = sessionDeposit / 4n;

    const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
    const approveTx = await usdc.approve(deployment.contracts.SessionVault, sessionDeposit + topUpAmount);
    await approveTx.wait();

    const settlerAuthorized = await sessionVault.authorizedSettlers(signer.address);
    if (!settlerAuthorized) {
      const authorizeTx = await sessionVault.authorizeSettler(signer.address);
      await authorizeTx.wait();
    }

    const fundTx = await sessionVault.fundSession(sessionDeposit, usdcAddress);
    const fundReceipt = await fundTx.wait();
    const sessionFundedEvent = fundReceipt?.logs
      ?.map((log: any) => {
        try {
          return sessionVault.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: any) => parsed?.name === "SessionFunded");
    const sessionId = String(sessionFundedEvent?.args?.sessionId || "");

    if (!sessionId) {
      warnings.push("Session fund succeeded but sessionId could not be parsed from logs.");
    } else {
      const topUpTx = await sessionVault.topUp(sessionId, topUpAmount);
      await topUpTx.wait();
      const settleTx = await sessionVault.settle(sessionId, settleAmount, signer.address);
      await settleTx.wait();
      const withdrawTx = await sessionVault.withdraw(sessionId);
      await withdrawTx.wait();
      checks.push(`Session lifecycle completed for ${sessionId}`);
    }
  } else {
    warnings.push(
      "Skipped session lifecycle. Set SMOKE_SESSION_DEPOSIT_ATOMIC to run fund/topup/settle/withdraw checks.",
    );
  }

  summary.completedAt = new Date().toISOString();
  summary.planId = planId.toString();
  summary.tokenId = tokenId.toString();

  const outDir = path.join(__dirname, "..", "deployments", "smoke");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${network.name}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Smoke report written to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Smoke script failed:", err);
    process.exit(1);
  });
