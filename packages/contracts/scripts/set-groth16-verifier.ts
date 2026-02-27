// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const verifierAddress = process.env.GROTH16_VERIFIER_ADDRESS;
  if (!verifierAddress || !ethers.isAddress(verifierAddress)) {
    throw new Error("Set GROTH16_VERIFIER_ADDRESS to a valid contract address.");
  }

  const deploymentFile = process.env.DEPLOYMENT_FILE || "sepolia-latest.json";
  const deploymentPath = path.join(__dirname, "..", "deployments", deploymentFile);

  let zkUsageVerifierAddress = process.env.ZK_USAGE_VERIFIER_ADDRESS;
  if (!zkUsageVerifierAddress) {
    if (!fs.existsSync(deploymentPath)) {
      throw new Error(`Deployment file not found: ${deploymentPath}`);
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    zkUsageVerifierAddress = deployment?.contracts?.ZKUsageVerifier;
  }

  if (!zkUsageVerifierAddress || !ethers.isAddress(zkUsageVerifierAddress)) {
    throw new Error("Could not resolve ZKUsageVerifier address. Set ZK_USAGE_VERIFIER_ADDRESS.");
  }

  const [signer] = await ethers.getSigners();
  console.log(`Using signer: ${signer.address}`);
  console.log(`ZKUsageVerifier: ${zkUsageVerifierAddress}`);
  console.log(`Groth16 Verifier: ${verifierAddress}`);

  const zkUsageVerifier = await ethers.getContractAt("ZKUsageVerifier", zkUsageVerifierAddress);
  const tx = await zkUsageVerifier.setGroth16Verifier(verifierAddress);
  console.log(`Submitted tx: ${tx.hash}`);
  await tx.wait();

  const configured = await zkUsageVerifier.groth16Verifier();
  console.log(`Configured verifier: ${configured}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
