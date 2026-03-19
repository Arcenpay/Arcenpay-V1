// @ts-ignore
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);

  console.log(`\n[approve-token] Network=${network.name} chainId=${chainId} deployer=${deployer.address}`);

  // Load the latest deployment to get the PlanFactory address
  const latestPath = path.join(__dirname, "..", "deployments", "sepolia-latest.json");
  if (!fs.existsSync(latestPath)) {
    throw new Error(`Deployment file not found at ${latestPath}`);
  }
  const deployment = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  const planFactoryAddr = deployment.contracts.PlanFactory;

  if (!planFactoryAddr) {
    throw new Error("PlanFactory address not found in deployment file");
  }

  // The Mock USDC address from the dashboard's .env
  const mockUsdcAddr = "0x9E6929598987f02462dD099873248bCDF84736fF";

  const PlanFactory = await ethers.getContractFactory("PlanFactory");
  const planFactory = PlanFactory.attach(planFactoryAddr) as any;

  console.log(`[approve-token] PlanFactory=${planFactoryAddr}`);
  console.log(`[approve-token] Approving token=${mockUsdcAddr}`);

  const tx = await planFactory.approveToken(mockUsdcAddr);
  console.log(`[approve-token] Tx hash: ${tx.hash}`);

  await tx.wait();
  console.log(`[approve-token] Token approved successfully!`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n[approve-token] Failed:", error);
    process.exit(1);
  });
