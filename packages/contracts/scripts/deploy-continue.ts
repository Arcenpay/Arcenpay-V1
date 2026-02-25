// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers } from "hardhat";

/**
 * ============================================================
 *  MEAP Protocol — Continuation Deployment
 *  Deploys contracts 5-7 using already-deployed addresses
 *  from the first deployment run.
 * ============================================================
 */

// --- Already deployed contract addresses (Sepolia) ---
const DEPLOYED = {
  PlanFactory: "0xc736f5d91aC0039b97A4Fc3540B8f3d59E7FdBa6",
  FeeCollector: "0x513fab5218045790364b33A38D95FE8E17403BAe",
  SubscriptionRegistry: "0xf45A9E5280F72260a713c50b0Ca4e4FB1e22Cc8A",
  SessionVault: "0x2dccEaad8551a620E4Fc736bb4d0fbb8D1A17D7C",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         MEAP Protocol — Continuation Deployment              ║
╠══════════════════════════════════════════════════════════════╣
║  Network:  ${network.name.padEnd(48)}║
║  Chain ID: ${String(network.chainId).padEnd(48)}║
║  Deployer: ${deployer.address.padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝
  `);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  💰 Deployer balance: ${ethers.formatEther(balance)} ETH\n`);

  console.log("  ─── Already Deployed ───");
  console.log(`  PlanFactory:          ${DEPLOYED.PlanFactory}`);
  console.log(`  FeeCollector:         ${DEPLOYED.FeeCollector}`);
  console.log(`  SubscriptionRegistry: ${DEPLOYED.SubscriptionRegistry}`);
  console.log(`  SessionVault:         ${DEPLOYED.SessionVault}`);
  console.log("\n  ─── Deploying Remaining Contracts ───\n");

  // ===============================
  // 5. Deploy ZKUsageVerifier
  // Constructor: (sessionVault, feeCollector, planFactory)
  // ===============================

  console.log("  [5/7] Deploying ZKUsageVerifier...");
  const ZKUsageVerifier = await ethers.getContractFactory("ZKUsageVerifier");
  const zkVerifier = await ZKUsageVerifier.deploy(
    DEPLOYED.SessionVault,
    DEPLOYED.FeeCollector,
    DEPLOYED.PlanFactory
  );
  await zkVerifier.waitForDeployment();
  const zkVerifierAddr = await zkVerifier.getAddress();
  console.log(`  ✅  ZKUsageVerifier:       ${zkVerifierAddr}`);

  // ===============================
  // 6. Deploy ERC7579AutopayModule
  // Constructor: (planFactory, subscriptionRegistry, feeCollector)
  // ===============================

  console.log("  [6/7] Deploying ERC7579AutopayModule...");
  const AutopayModule = await ethers.getContractFactory("ERC7579AutopayModule");
  const autopayModule = await AutopayModule.deploy(
    DEPLOYED.PlanFactory,
    DEPLOYED.SubscriptionRegistry,
    DEPLOYED.FeeCollector
  );
  await autopayModule.waitForDeployment();
  const autopayModuleAddr = await autopayModule.getAddress();
  console.log(`  ✅  ERC7579AutopayModule:  ${autopayModuleAddr}`);

  // ===============================
  // 7. Deploy MirrorRegistry
  // Constructor: none (Ownable)
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

  // Get contract instances for already-deployed contracts
  const registry = await ethers.getContractAt("SubscriptionRegistry", DEPLOYED.SubscriptionRegistry);
  const feeCollector = await ethers.getContractAt("FeeCollector", DEPLOYED.FeeCollector);
  const sessionVault = await ethers.getContractAt("SessionVault", DEPLOYED.SessionVault);

  // 1. Authorize AutopayModule as biller on SubscriptionRegistry
  console.log("  • Authorizing AutopayModule as biller on SubscriptionRegistry...");
  const authBillerTx = await registry.authorizeBiller(autopayModuleAddr);
  await authBillerTx.wait();
  console.log("  ✅  AutopayModule authorized as biller");

  // 2. Authorize AutopayModule as collector on FeeCollector
  console.log("  • Authorizing AutopayModule as collector on FeeCollector...");
  const authCollectorTx = await feeCollector.authorizeCollector(autopayModuleAddr);
  await authCollectorTx.wait();
  console.log("  ✅  AutopayModule authorized as fee collector");

  // 3. Authorize ZKUsageVerifier as settler on SessionVault
  console.log("  • Authorizing ZKUsageVerifier as settler on SessionVault...");
  const authSettlerTx = await sessionVault.authorizeSettler(zkVerifierAddr);
  await authSettlerTx.wait();
  console.log("  ✅  ZKUsageVerifier authorized as settler");

  // 4. Authorize ZKUsageVerifier as collector on FeeCollector
  console.log("  • Authorizing ZKUsageVerifier as collector on FeeCollector...");
  const authZkCollectorTx = await feeCollector.authorizeCollector(zkVerifierAddr);
  await authZkCollectorTx.wait();
  console.log("  ✅  ZKUsageVerifier authorized as fee collector");

  // ===============================
  //  Full Summary
  // ===============================

  const allContracts = {
    ...DEPLOYED,
    ZKUsageVerifier: zkVerifierAddr,
    ERC7579AutopayModule: autopayModuleAddr,
    MirrorRegistry: mirrorRegistryAddr,
  };

  const summary = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    contracts: allContracts,
    config: {
      USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      treasury: deployer.address,
    },
    deployedAt: new Date().toISOString(),
  };

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          FULL DEPLOYMENT COMPLETE ✅                         ║
╠══════════════════════════════════════════════════════════════╣
║  PlanFactory:           ${allContracts.PlanFactory}  ║
║  FeeCollector:          ${allContracts.FeeCollector}  ║
║  SubscriptionRegistry:  ${allContracts.SubscriptionRegistry}  ║
║  SessionVault:          ${allContracts.SessionVault}  ║
║  ZKUsageVerifier:       ${allContracts.ZKUsageVerifier}  ║
║  ERC7579AutopayModule:  ${allContracts.ERC7579AutopayModule}  ║
║  MirrorRegistry:        ${allContracts.MirrorRegistry}  ║
╠══════════════════════════════════════════════════════════════╣
║  Explorer: https://sepolia.etherscan.io                      ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Save deployment data
  const fs = await import("fs");
  const path = await import("path");
  const deploymentsDir = path.join(__dirname, "..", "deployments");

  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const outputPath = path.join(deploymentsDir, `sepolia-${new Date().toISOString().split("T")[0]}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  console.log(`  📄 Deployment data: ${outputPath}`);

  const latestPath = path.join(deploymentsDir, "sepolia-latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));
  console.log(`  📄 Latest: ${latestPath}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
