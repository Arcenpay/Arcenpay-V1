// @ts-ignore
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_USDC_BY_CHAIN: Record<number, string> = {
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  5042002: "0x3600000000000000000000000000000000000000",
  // BOT Chain has no canonical USDC — official bridged USDT per
  // dev-docs.botchain.ai/docs/Bridge/contract-addresses.
  968: "0x75edC9335175Fc0552D51D48439F229c10420fe3",
  677: "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
};

function deploymentFileFor(chainId: number): string {
  if (chainId === 11155111) return "sepolia-latest.json";
  if (chainId === 84532) return "baseSepolia-latest.json";
  if (chainId === 8453) return "baseMainnet-latest.json";
  if (chainId === 5042002) return "arcTestnet-latest.json";
  if (chainId === 968) return "botTestnet-latest.json";
  if (chainId === 677) return "botMainnet-latest.json";
  throw new Error(`No deployment file mapping for chainId=${chainId}`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);

  console.log(`\n[approve-token] Network=${network.name} chainId=${chainId} deployer=${deployer.address}`);

  const latestPath = path.join(__dirname, "..", "deployments", deploymentFileFor(chainId));
  if (!fs.existsSync(latestPath)) {
    throw new Error(`Deployment file not found at ${latestPath}`);
  }

  const deployment = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  const planFactoryAddr = deployment.contracts.PlanFactory;
  if (!planFactoryAddr) {
    throw new Error("PlanFactory address not found in deployment file");
  }

  const tokenAddress =
    process.env.USDC_ADDRESS ||
    deployment.config?.USDC ||
    DEFAULT_USDC_BY_CHAIN[chainId];

  if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
    throw new Error(`Invalid token address: ${tokenAddress}`);
  }

  const PlanFactory = await ethers.getContractFactory("PlanFactory");
  const planFactory = PlanFactory.attach(planFactoryAddr) as any;

  console.log(`[approve-token] PlanFactory=${planFactoryAddr}`);
  console.log(`[approve-token] Approving token=${tokenAddress}`);

  const tx = await planFactory.approveToken(tokenAddress);
  console.log(`[approve-token] Tx hash: ${tx.hash}`);

  await tx.wait();
  console.log("[approve-token] Token approved successfully");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n[approve-token] Failed:", error);
    process.exit(1);
  });
