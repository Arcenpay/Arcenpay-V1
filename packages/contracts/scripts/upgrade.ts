// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

function deploymentFileFor(chainId: number): string {
  if (chainId === 11155111) return "sepolia-latest.json";
  if (chainId === 84532) return "baseSepolia-latest.json";
  if (chainId === 8453) return "baseMainnet-latest.json";
  if (chainId === 5042002) return "arcTestnet-latest.json";
  throw new Error(`No deployment file mapping for chainId=${chainId}`);
}

async function main() {
  const contractName = process.env.UPGRADE_CONTRACT_NAME;
  if (!contractName) {
    throw new Error("UPGRADE_CONTRACT_NAME is required.");
  }

  const [deployer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);
  const deploymentPath = path.join(
    __dirname,
    "..",
    "deployments",
    process.env.UPGRADE_DEPLOYMENT_FILE || deploymentFileFor(chainId),
  );

  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}`);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const proxyAddress =
    process.env.UPGRADE_PROXY_ADDRESS || deployment.contracts?.[contractName];

  if (!proxyAddress || !ethers.isAddress(proxyAddress)) {
    throw new Error(`Proxy address missing or invalid for ${contractName}.`);
  }

  const Factory = await ethers.getContractFactory(contractName);
  const implementation = await Factory.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();

  const upgradeData = process.env.UPGRADE_CALL_DATA || "0x";
  if (!ethers.isHexString(upgradeData)) {
    throw new Error(`UPGRADE_CALL_DATA must be hex calldata, received: ${upgradeData}`);
  }

  const proxy = await ethers.getContractAt(contractName, proxyAddress, deployer);

  console.log(`\n[upgrade] Network=${network.name} chainId=${chainId} deployer=${deployer.address}`);
  console.log(`[upgrade] Contract=${contractName}`);
  console.log(`[upgrade] Proxy=${proxyAddress}`);
  console.log(`[upgrade] New implementation=${implementationAddress}`);

  const tx = await proxy.upgradeToAndCall(implementationAddress, upgradeData);
  console.log(`[upgrade] Tx hash: ${tx.hash}`);
  await tx.wait();

  deployment.implementations = {
    ...(deployment.implementations || {}),
    [contractName]: implementationAddress,
  };
  deployment.lastUpgrade = {
    contractName,
    proxyAddress,
    implementationAddress,
    txHash: tx.hash,
    upgradedAt: new Date().toISOString(),
  };
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));

  console.log(`[upgrade] Deployment file updated: ${deploymentPath}`);
  console.log("[upgrade] Upgrade complete");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n[upgrade] Failed:", error);
    process.exit(1);
  });
