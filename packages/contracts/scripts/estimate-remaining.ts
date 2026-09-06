import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("=== SIMULATING REMAINING DEPLOYMENTS FOR GAS ESTIMATION ===");
  console.log("Deployer:", deployer.address);

  // We have existing PlanFactory and FeeCollector proxies:
  const planFactoryProxy = "0x09fD8422638F4d6eA05F6Dcb2FB15Bea6eC59f41";
  const feeCollectorProxy = "0x17375ec258cDABEB491AB9ae3F78428BC26Aa382";

  const ProxyFactory = await ethers.getContractFactory(
    "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
  );

  let totalGas = 0n;
  const breakdown: { step: string; gasUsed: bigint }[] = [];

  // Helper function to deploy implementation + proxy and track gas
  async function deployUUPS(name: string, initArgs: unknown[]) {
    const ImplFactory = await ethers.getContractFactory(name);

    // 1. Implementation
    const deployTx = await ImplFactory.getDeployTransaction();
    const implContract = await ImplFactory.deploy();
    const implReceipt = await implContract.deploymentTransaction()?.wait();
    const implGas = implReceipt?.gasUsed ?? 0n;
    totalGas += implGas;
    const implAddress = await implContract.getAddress();
    breakdown.push({ step: `${name} Implementation`, gasUsed: implGas });

    // 2. Proxy
    const initData = ImplFactory.interface.encodeFunctionData("initialize", initArgs);
    const proxyContract = await ProxyFactory.deploy(implAddress, initData);
    const proxyReceipt = await proxyContract.deploymentTransaction()?.wait();
    const proxyGas = proxyReceipt?.gasUsed ?? 0n;
    totalGas += proxyGas;
    const proxyAddress = await proxyContract.getAddress();
    breakdown.push({ step: `${name} ERC1967Proxy (initialize)`, gasUsed: proxyGas });

    const attached = ImplFactory.attach(proxyAddress);
    return { implAddress, proxyAddress, attached };
  }

  // 1. SubscriptionRegistry
  const subReg = await deployUUPS("SubscriptionRegistry", [
    deployer.address,
    "ArcenPay Subscription",
    "ARCENPAY-SUB",
    planFactoryProxy,
  ]);

  // 2. SessionVault
  const sessionVault = await deployUUPS("SessionVault", [deployer.address]);

  // 3. ZKUsageVerifier
  const zkVerifier = await deployUUPS("ZKUsageVerifier", [
    deployer.address,
    sessionVault.proxyAddress,
    feeCollectorProxy,
    planFactoryProxy,
  ]);

  // 4. ERC7579AutopayModule
  const autopay = await deployUUPS("ERC7579AutopayModule", [
    deployer.address,
    planFactoryProxy,
    subReg.proxyAddress,
    feeCollectorProxy,
    deployer.address,
  ]);

  // 5. MirrorRegistry
  const mirror = await deployUUPS("MirrorRegistry", [deployer.address]);

  // Role wirings:
  // Role 1: subscriptionRegistry.authorizeBiller(autopayModule.proxy)
  const tx1 = await (subReg.attached as any).authorizeBiller(autopay.proxyAddress);
  const rc1 = await tx1.wait();
  totalGas += rc1.gasUsed;
  breakdown.push({ step: "Role: SubscriptionRegistry.authorizeBiller", gasUsed: rc1.gasUsed });

  // For FeeCollector, since the real FeeCollector is on-chain, let us deploy a mock FeeCollector in simulation to measure authorizeCollector gas
  const FeeCollectorFactory = await ethers.getContractFactory("FeeCollector");
  const mockFeeCollectorImpl = await FeeCollectorFactory.deploy();
  await mockFeeCollectorImpl.waitForDeployment();
  const fcInitData = FeeCollectorFactory.interface.encodeFunctionData("initialize", [deployer.address, deployer.address]);
  const mockFeeCollectorProxy = await ProxyFactory.deploy(await mockFeeCollectorImpl.getAddress(), fcInitData);
  await mockFeeCollectorProxy.waitForDeployment();
  const mockFeeCollector = FeeCollectorFactory.attach(await mockFeeCollectorProxy.getAddress());

  // Role 2: feeCollector.authorizeCollector(autopayModule.proxy)
  const tx2 = await (mockFeeCollector as any).authorizeCollector(autopay.proxyAddress);
  const rc2 = await tx2.wait();
  totalGas += rc2.gasUsed;
  breakdown.push({ step: "Role: FeeCollector.authorizeCollector (Autopay)", gasUsed: rc2.gasUsed });

  // Role 3: feeCollector.authorizeCollector(zkVerifier.proxy)
  const tx3 = await (mockFeeCollector as any).authorizeCollector(zkVerifier.proxyAddress);
  const rc3 = await tx3.wait();
  totalGas += rc3.gasUsed;
  breakdown.push({ step: "Role: FeeCollector.authorizeCollector (ZKVerifier)", gasUsed: rc3.gasUsed });

  // Role 4: sessionVault.authorizeSettler(zkVerifier.proxy)
  const tx4 = await (sessionVault.attached as any).authorizeSettler(zkVerifier.proxyAddress);
  const rc4 = await tx4.wait();
  totalGas += rc4.gasUsed;
  breakdown.push({ step: "Role: SessionVault.authorizeSettler", gasUsed: rc4.gasUsed });

  console.log("\n--- GAS BREAKDOWN ---");
  for (const b of breakdown) {
    console.log(`${b.step.padEnd(50)}: ${b.gasUsed.toLocaleString()} gas`);
  }
  console.log("-----------------------------------------------------------------");
  console.log(`TOTAL GAS ESTIMATE (exact): ${totalGas.toLocaleString()} gas`);

  // With 20% safety margin:
  const safetyGas = (totalGas * 120n) / 100n;
  console.log(`TOTAL GAS ESTIMATE (+20% safety buffer): ${safetyGas.toLocaleString()} gas`);

  // At 20 gwei (standard BOT chain gas price):
  const gasPriceWei = 20_000_000_000n; // 20 gwei
  const exactCost = totalGas * gasPriceWei;
  const safetyCost = safetyGas * gasPriceWei;

  console.log(`\nAt 20 gwei:`);
  console.log(`Exact cost:  ${ethers.formatEther(exactCost)} BOT`);
  console.log(`Safety cost (+20%): ${ethers.formatEther(safetyCost)} BOT`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
