// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers, network } from "hardhat";

const TESTNET_CHAIN_IDS = new Set([11155111, 84532, 5042002]);

function parseUnits6(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error(
      `Invalid MINT_AMOUNT "${value}". Use a numeric value with up to 6 decimals (example: 1000 or 2500.5).`,
    );
  }
  const [whole, fraction = ""] = normalized.split(".");
  const paddedFraction = (fraction + "000000").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(paddedFraction);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);

  if (!TESTNET_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `Refusing to deploy mock token on non-testnet chain ${chainId}. Allowed: 11155111 (Sepolia), 84532 (Base Sepolia).`,
    );
  }

  const recipient = process.env.MOCK_USDC_RECIPIENT;
  if (!recipient || !ethers.isAddress(recipient)) {
    throw new Error(
      "MOCK_USDC_RECIPIENT is required and must be a valid EVM address.",
    );
  }

  const mintAmountInput = process.env.MOCK_USDC_MINT_AMOUNT || "10000";
  const mintAmount = parseUnits6(mintAmountInput);

  console.log(
    `[mock-usdc] Network=${network.name} chainId=${chainId} deployer=${deployer.address}`,
  );
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[mock-usdc] Deployer ETH=${ethers.formatEther(balance)}`);
  if (balance === 0n) {
    throw new Error("Deployer has 0 ETH — cannot deploy.");
  }

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUsdc = await MockUSDC.deploy(deployer.address);
  await mockUsdc.waitForDeployment();
  const tokenAddress = await mockUsdc.getAddress();

  console.log(`[mock-usdc] Deployed at ${tokenAddress}`);
  console.log(`[mock-usdc] Minting ${mintAmountInput} mUSDC to ${recipient}`);

  const tx = await mockUsdc.mint(recipient, mintAmount);
  const receipt = await tx.wait();

  console.log(`[mock-usdc] Mint tx hash: ${tx.hash}`);
  console.log(`[mock-usdc] Mint confirmed in block ${receipt?.blockNumber ?? "?"}`);
  console.log(`[mock-usdc] Done`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[mock-usdc] Failed:", error);
    process.exit(1);
  });
