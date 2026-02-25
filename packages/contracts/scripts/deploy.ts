// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers } from "hardhat";

/**
 * ============================================================
 *  MEAP Protocol — Full Deployment Script
 *  Deploys all core contracts in correct dependency order:
 *    1. PlanFactory
 *    2. FeeCollector
 *    3. SubscriptionRegistry
 *    4. SessionVault
 *    5. ZKUsageVerifier
 *    6. ERC7579AutopayModule
 *    7. MirrorRegistry
 * ============================================================
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                MEAP Protocol Deployment                      ║
╠══════════════════════════════════════════════════════════════╣
║  Network:  ${network.name.padEnd(48)}║
║  Chain ID: ${String(network.chainId).padEnd(48)}║
║  Deployer: ${deployer.address.padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝
  `);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  💰 Deployer balance: ${ethers.formatEther(balance)} ETH\n`);

  if (balance === 0n) {
    throw new Error("Deployer has 0 ETH — cannot deploy. Fund the wallet first.");
  }

  console.log("  ─── Deploying Contracts ───\n");

  // ===============================
  // 1. Deploy PlanFactory
  // ===============================

  // For Sepolia testnet, we use a mock USDC address (or deploy one)
  // Using well-known Sepolia USDC: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
  const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

  console.log("  [1/7] Deploying PlanFactory...");
  const PlanFactory = await ethers.getContractFactory("PlanFactory");
  const planFactory = await PlanFactory.deploy([USDC_ADDRESS]);
  await planFactory.waitForDeployment();
  const planFactoryAddr = await planFactory.getAddress();
  console.log(`  ✅  PlanFactory:           ${planFactoryAddr}`);

  // ===============================
  // 2. Deploy FeeCollector
  // ===============================

  // Treasury = deployer for now (change later)
  console.log("  [2/7] Deploying FeeCollector...");
  const FeeCollector = await ethers.getContractFactory("FeeCollector");
  const feeCollector = await FeeCollector.deploy(deployer.address);
  await feeCollector.waitForDeployment();
  const feeCollectorAddr = await feeCollector.getAddress();
  console.log(`  ✅  FeeCollector:          ${feeCollectorAddr}`);

  // ===============================
  // 3. Deploy SubscriptionRegistry
  // ===============================

  console.log("  [3/7] Deploying SubscriptionRegistry...");
  const SubscriptionRegistry = await ethers.getContractFactory("SubscriptionRegistry");
  const registry = await SubscriptionRegistry.deploy(
    "MEAP Subscription",
    "MEAP-SUB",
    planFactoryAddr
  );
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`  ✅  SubscriptionRegistry:  ${registryAddr}`);

  // ===============================
  // 4. Deploy SessionVault
  // ===============================

  console.log("  [4/7] Deploying SessionVault...");
  const SessionVault = await ethers.getContractFactory("SessionVault");
  const sessionVault = await SessionVault.deploy();
  await sessionVault.waitForDeployment();
  const sessionVaultAddr = await sessionVault.getAddress();
  console.log(`  ✅  SessionVault:          ${sessionVaultAddr}`);

  // ===============================
  // 5. Deploy ZKUsageVerifier
  // ===============================

  console.log("  [5/7] Deploying ZKUsageVerifier...");
  const ZKUsageVerifier = await ethers.getContractFactory("ZKUsageVerifier");
  const zkVerifier = await ZKUsageVerifier.deploy(
    sessionVaultAddr,
    feeCollectorAddr,
    planFactoryAddr
  );
  await zkVerifier.waitForDeployment();
  const zkVerifierAddr = await zkVerifier.getAddress();
  console.log(`  ✅  ZKUsageVerifier:       ${zkVerifierAddr}`);

  // ===============================
  // 6. Deploy ERC7579AutopayModule
  // ===============================

  console.log("  [6/7] Deploying ERC7579AutopayModule...");
  const AutopayModule = await ethers.getContractFactory("ERC7579AutopayModule");
  const autopayModule = await AutopayModule.deploy(
    planFactoryAddr,
    registryAddr,
    feeCollectorAddr
  );
  await autopayModule.waitForDeployment();
  const autopayModuleAddr = await autopayModule.getAddress();
  console.log(`  ✅  ERC7579AutopayModule:  ${autopayModuleAddr}`);

  // ===============================
  // 7. Deploy MirrorRegistry
  // ===============================

  console.log("  [7/7] Deploying MirrorRegistry...");
  const MirrorRegistry = await ethers.getContractFactory("MirrorRegistry");
  const mirrorRegistry = await MirrorRegistry.deploy();
  await mirrorRegistry.waitForDeployment();
  const mirrorRegistryAddr = await mirrorRegistry.getAddress();
  console.log(`  ✅  MirrorRegistry:        ${mirrorRegistryAddr}`);

  // ===============================
  //  Post-Deployment Configuration
  // ===============================

  console.log("\n  ─── Post-Deployment Configuration ───\n");

  // Authorize AutopayModule as biller on SubscriptionRegistry
  console.log("  • Authorizing AutopayModule as biller on SubscriptionRegistry...");
  const authBillerTx = await registry.authorizeBiller(autopayModuleAddr);
  await authBillerTx.wait();
  console.log("  ✅  AutopayModule authorized as biller");

  // Authorize FeeCollector for AutopayModule
  console.log("  • Authorizing AutopayModule as collector on FeeCollector...");
  const authCollectorTx = await feeCollector.authorizeCollector(autopayModuleAddr);
  await authCollectorTx.wait();
  console.log("  ✅  AutopayModule authorized as fee collector");

  // Authorize ZKUsageVerifier as settler on SessionVault
  console.log("  • Authorizing ZKUsageVerifier as settler on SessionVault...");
  const authSettlerTx = await sessionVault.authorizeSettler(zkVerifierAddr);
  await authSettlerTx.wait();
  console.log("  ✅  ZKUsageVerifier authorized as settler");

  // ===============================
  //  Summary
  // ===============================

  const summary = {
    network: network.name,
    chainId: Number(network.chainId),
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
      USDC: USDC_ADDRESS,
      treasury: deployer.address,
    },
  };

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                 DEPLOYMENT COMPLETE ✅                        ║
╠══════════════════════════════════════════════════════════════╣
║  PlanFactory:           ${planFactoryAddr}  ║
║  FeeCollector:          ${feeCollectorAddr}  ║
║  SubscriptionRegistry:  ${registryAddr}  ║
║  SessionVault:          ${sessionVaultAddr}  ║
║  ZKUsageVerifier:       ${zkVerifierAddr}  ║
║  ERC7579AutopayModule:  ${autopayModuleAddr}  ║
║  MirrorRegistry:        ${mirrorRegistryAddr}  ║
╠══════════════════════════════════════════════════════════════╣
║  Explorer: https://sepolia.etherscan.io/address/<addr>       ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Write deployment addresses to JSON for SDK consumption
  const fs = await import("fs");
  const path = await import("path");
  const deploymentsDir = path.join(__dirname, "..", "deployments");

  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const outputPath = path.join(
    deploymentsDir,
    `sepolia-${new Date().toISOString().split("T")[0]}.json`
  );
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  console.log(`  📄 Deployment data saved to: ${outputPath}\n`);

  // Also write a latest.json for easy SDK consumption
  const latestPath = path.join(deploymentsDir, "sepolia-latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));
  console.log(`  📄 Latest deployment: ${latestPath}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
