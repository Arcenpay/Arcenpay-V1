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
    startedAt: new Date().toISOString(),
    checks: [] as string[],
    warnings: [] as string[],
  };

  const checks = summary.checks as string[];
  const warnings = summary.warnings as string[];

  // 1) Provider registration + plan create
  const isProvider = await planFactory.isProvider(signer.address);
  if (!isProvider) {
    const tx = await planFactory.registerProvider(signer.address);
    await tx.wait();
    checks.push("Registered signer as provider");
  } else {
    checks.push("Signer already registered as provider");
  }

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

  const mintTx = await registry.mint(signer.address, planId, duration);
  await mintTx.wait();
  const tokenId = (await registry.getWalletSubscription(signer.address)) as bigint;
  checks.push(`Minted subscription token ${tokenId.toString()}`);

  const renewTx = await registry.renew(tokenId, renewalExtension);
  await renewTx.wait();
  checks.push("Renewed subscription");

  const cancelTx = await registry.cancel(tokenId);
  await cancelTx.wait();
  const isValidAfterCancel = await registry.isValid(tokenId);
  checks.push(`Cancelled subscription (isValid=${String(isValidAfterCancel)})`);

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

