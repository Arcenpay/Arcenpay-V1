// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

function resolveSessionVaultAddress(): string {
  if (process.env.SESSION_VAULT_ADDRESS) {
    return process.env.SESSION_VAULT_ADDRESS;
  }

  const latestPath = path.join(__dirname, "..", "deployments", "sepolia-latest.json");
  if (!fs.existsSync(latestPath)) {
    throw new Error(
      "SESSION_VAULT_ADDRESS not set and deployments/sepolia-latest.json not found.",
    );
  }

  const latest = JSON.parse(fs.readFileSync(latestPath, "utf8")) as {
    contracts?: { SessionVault?: string };
  };
  const address = latest.contracts?.SessionVault;
  if (!address) {
    throw new Error("Could not resolve SessionVault address from sepolia-latest.json.");
  }

  return address;
}

async function main() {
  const facilitatorAddress = process.env.FACILITATOR_ADDRESS;
  if (!facilitatorAddress) {
    throw new Error("FACILITATOR_ADDRESS is required.");
  }
  if (!ethers.isAddress(facilitatorAddress)) {
    throw new Error(`Invalid FACILITATOR_ADDRESS: ${facilitatorAddress}`);
  }

  const sessionVaultAddress = resolveSessionVaultAddress();
  if (!ethers.isAddress(sessionVaultAddress)) {
    throw new Error(`Invalid SESSION_VAULT_ADDRESS: ${sessionVaultAddress}`);
  }

  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const sessionVault = await ethers.getContractAt("SessionVault", sessionVaultAddress);

  console.log(`
Network:   ${network.name} (${network.chainId})
Signer:    ${signer.address}
SessionVault: ${sessionVaultAddress}
Facilitator:  ${facilitatorAddress}
  `);

  const alreadyAuthorized = await sessionVault.authorizedSettlers(facilitatorAddress);
  if (alreadyAuthorized) {
    console.log("Facilitator is already authorized as SessionVault settler.");
    return;
  }

  console.log("Authorizing facilitator as SessionVault settler...");
  const tx = await sessionVault.authorizeSettler(facilitatorAddress);
  const receipt = await tx.wait();

  console.log(`✅ Authorized in tx: ${receipt?.hash || tx.hash}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Failed to authorize facilitator settler:", error);
    process.exit(1);
  });
