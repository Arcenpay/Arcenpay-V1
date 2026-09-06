import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);

  console.log(`\n======================================================`);
  console.log(`[status] Network=${network.name} (chainId=${chainId})`);
  console.log(`[status] Deployer Address: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 20_000_000_000n;

  console.log(`[status] Current Balance: ${ethers.formatEther(balance)} native tokens`);
  console.log(`[status] Current Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  console.log(`======================================================\n`);

  const slug = chainId === 677 ? "botMainnet" : chainId === 968 ? "botTestnet" : "other";
  const latestPath = path.join(__dirname, "..", "deployments", `${slug}-latest.json`);

  let existing: any = {};
  if (fs.existsSync(latestPath)) {
    existing = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  }

  const contracts = [
    "PlanFactory",
    "FeeCollector",
    "SubscriptionRegistry",
    "SessionVault",
    "ZKUsageVerifier",
    "ERC7579AutopayModule",
    "MirrorRegistry",
  ];

  console.log("CONTRACT STATUS:");
  console.log("------------------------------------------------------");
  let deployedCount = 0;
  for (const name of contracts) {
    const proxy = existing.contracts?.[name];
    const impl = existing.implementations?.[name];
    if (proxy && ethers.isAddress(proxy)) {
      const code = await ethers.provider.getCode(proxy);
      if (code && code !== "0x" && code.length > 2) {
        console.log(`✅ ${name.padEnd(22)}: DEPLOYED (proxy=${proxy}, code=${code.length}b)`);
        deployedCount++;
        continue;
      }
    }
    console.log(`⏳ ${name.padEnd(22)}: PENDING DEPLOYMENT`);
  }

  console.log("\n------------------------------------------------------");
  console.log(`Summary: ${deployedCount} / ${contracts.length} contracts deployed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
