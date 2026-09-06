// @ts-ignore -- ethers is injected by @nomicfoundation/hardhat-toolbox at runtime
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

type DeploymentShape = {
  network: string;
  chainId: number;
  contracts: {
    PlanFactory: string;
  };
};

type Mode =
  | "inspect"
  | "transfer-owner"
  | "register-provider"
  | "calldata-register-provider"
  | "calldata-transfer-owner";

const PLAN_FACTORY_ABI = [
  "function owner() view returns (address)",
  "function isProvider(address provider) view returns (bool)",
  "function registerProvider(address provider)",
  "function transferOwnership(address newOwner)",
];

function deploymentFileFor(chainId: number): string {
  if (chainId === 11155111) return "sepolia-latest.json";
  if (chainId === 84532) return "baseSepolia-latest.json";
  if (chainId === 8453) return "baseMainnet-latest.json";
  if (chainId === 5042002) return "arcTestnet-latest.json";
  if (chainId === 968) return "botTestnet-latest.json";
  if (chainId === 677) return "botMainnet-latest.json";
  throw new Error(`No deployment file mapping for chainId=${chainId}`);
}

function normalizeAddress(raw: string | undefined, label: string): string {
  const value = (raw || "").trim();
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${label} must be a valid 0x address.`);
  }
  return value;
}

function resolvePlanFactoryAddress(chainId: number): string {
  const envAddress = (process.env.PLAN_FACTORY_ADDRESS || "").trim();
  if (envAddress) return normalizeAddress(envAddress, "PLAN_FACTORY_ADDRESS");

  const fileName = process.env.SMOKE_DEPLOYMENT_FILE || deploymentFileFor(chainId);
  const fullPath = path.join(__dirname, "..", "deployments", fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Deployment file not found: ${fullPath}. Set PLAN_FACTORY_ADDRESS to override.`,
    );
  }
  const deployment = JSON.parse(fs.readFileSync(fullPath, "utf8")) as DeploymentShape;
  return normalizeAddress(deployment.contracts.PlanFactory, "deployment.contracts.PlanFactory");
}

async function assertOwner(
  expectedOwner: string,
  planFactory: { owner: () => Promise<string> },
): Promise<void> {
  const onChainOwner = await planFactory.owner();
  if (onChainOwner.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error(
      `Signer is not owner. signer=${expectedOwner} onChainOwner=${onChainOwner}`,
    );
  }
}

async function main() {
  const mode = ((process.env.MODE || "inspect").trim() || "inspect") as Mode;
  const [signer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);
  const planFactoryAddress = resolvePlanFactoryAddress(chainId);
  const planFactory = new ethers.Contract(
    planFactoryAddress,
    PLAN_FACTORY_ABI,
    signer,
  ) as unknown as {
    owner: () => Promise<string>;
    isProvider: (provider: string) => Promise<boolean>;
    registerProvider: (provider: string) => Promise<{ hash: string; wait: () => Promise<unknown> }>;
    transferOwnership: (newOwner: string) => Promise<{ hash: string; wait: () => Promise<unknown> }>;
    interface: {
      encodeFunctionData: (fragment: string, values?: readonly unknown[]) => string;
    };
  };

  const providerAddressRaw = process.env.PROVIDER_ADDRESS || process.env.RELAYER_ADDRESS || signer.address;
  const providerAddress = normalizeAddress(providerAddressRaw, "PROVIDER_ADDRESS/RELAYER_ADDRESS");
  const newOwnerRaw = process.env.NEW_OWNER_ADDRESS || "";

  if (mode === "inspect") {
    const owner = await planFactory.owner();
    const isProvider = await planFactory.isProvider(providerAddress);
    const ownerCode = await ethers.provider.getCode(owner);
    const result = {
      mode,
      network: network.name,
      chainId,
      planFactoryAddress,
      owner,
      ownerIsContract: ownerCode !== "0x",
      providerAddress,
      providerRegistered: isProvider,
      signer: signer.address,
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (mode === "calldata-register-provider") {
    const data = planFactory.interface.encodeFunctionData("registerProvider", [
      providerAddress,
    ]);
    console.log(
      JSON.stringify(
        {
          mode,
          to: planFactoryAddress,
          value: "0",
          data,
          operation: 0,
          functionSignature: "registerProvider(address)",
          args: [providerAddress],
        },
        null,
        2,
      ),
    );
    return;
  }

  if (mode === "calldata-transfer-owner") {
    const newOwner = normalizeAddress(newOwnerRaw, "NEW_OWNER_ADDRESS");
    const data = planFactory.interface.encodeFunctionData("transferOwnership", [
      newOwner,
    ]);
    console.log(
      JSON.stringify(
        {
          mode,
          to: planFactoryAddress,
          value: "0",
          data,
          operation: 0,
          functionSignature: "transferOwnership(address)",
          args: [newOwner],
        },
        null,
        2,
      ),
    );
    return;
  }

  if (mode === "register-provider") {
    await assertOwner(signer.address, planFactory);
    const registered = await planFactory.isProvider(providerAddress);
    if (registered) {
      console.log(
        JSON.stringify(
          {
            mode,
            network: network.name,
            chainId,
            planFactoryAddress,
            providerAddress,
            alreadyRegistered: true,
          },
          null,
          2,
        ),
      );
      return;
    }

    const tx = await planFactory.registerProvider(providerAddress);
    await tx.wait();
    console.log(
      JSON.stringify(
        {
          mode,
          network: network.name,
          chainId,
          planFactoryAddress,
          providerAddress,
          txHash: tx.hash,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (mode === "transfer-owner") {
    const newOwner = normalizeAddress(newOwnerRaw, "NEW_OWNER_ADDRESS");
    await assertOwner(signer.address, planFactory);
    const tx = await planFactory.transferOwnership(newOwner);
    await tx.wait();
    console.log(
      JSON.stringify(
        {
          mode,
          network: network.name,
          chainId,
          planFactoryAddress,
          previousOwner: signer.address,
          newOwner,
          txHash: tx.hash,
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(
    `Unsupported MODE=${mode}. Supported: inspect, transfer-owner, register-provider, calldata-register-provider, calldata-transfer-owner`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[ops-plan-factory-owner] failed:", err);
    process.exit(1);
  });
