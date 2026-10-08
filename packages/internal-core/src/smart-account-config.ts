import type { Address } from "viem";
import {
  entryPoint06Address,
  entryPoint07Address,
} from "viem/account-abstraction";

export type SmartAccountMetaFactoryMode = boolean | "optional";
export type SmartAccountEntryPointVersion = "0.6" | "0.7";
export type SmartAccountKernelVersion =
  | "0.2.1"
  | "0.2.2"
  | "0.2.3"
  | "0.2.4"
  | "0.3.0-beta"
  | "0.3.1"
  | "0.3.2"
  | "0.3.3";

export interface SmartAccountKernelConfig {
  entryPointVersion: SmartAccountEntryPointVersion;
  entryPointAddress: Address;
  version?: SmartAccountKernelVersion;
  factoryAddress?: Address;
  metaFactoryAddress?: Address;
  accountLogicAddress?: Address;
  validatorAddress?: Address;
  useMetaFactory?: SmartAccountMetaFactoryMode;
  verificationGasLimitFloor?: bigint;
}

const ARC_TESTNET_CHAIN_ID = 5042002;
const DEFAULT_ENTRYPOINT_VERSION = "0.7" as const;
const DEFAULT_KERNEL_VERSION_V06 = "0.2.4" as const;
const DEFAULT_KERNEL_VERSION_V07 = "0.3.1" as const;
const ARC_TESTNET_VERIFICATION_GAS_FLOOR = 800_000n;

function isAddress(value: string | undefined): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function getEnv(names: string[]): string | undefined {
  if (typeof process === "undefined") return undefined;

  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  return undefined;
}

function withChainId(baseNames: string[], chainId: number): string[] {
  return [
    ...baseNames.map((name) => `${name}_${chainId}`),
    ...baseNames,
  ];
}

function getAddressEnv(baseNames: string[], chainId: number): Address | undefined {
  const value = getEnv(withChainId(baseNames, chainId));
  return isAddress(value) ? value : undefined;
}

function getBigIntEnv(baseNames: string[], chainId: number): bigint | undefined {
  const value = getEnv(withChainId(baseNames, chainId));
  if (!value) return undefined;

  const normalized = value.replaceAll("_", "");

  try {
    return BigInt(normalized);
  } catch {
    return undefined;
  }
}

function parseMetaFactoryMode(
  value: string | undefined,
): SmartAccountMetaFactoryMode | undefined {
  if (!value) return undefined;

  switch (value.trim().toLowerCase()) {
    case "true":
    case "1":
    case "yes":
    case "on":
      return true;
    case "false":
    case "0":
    case "no":
    case "off":
      return false;
    case "optional":
      return "optional";
    default:
      return undefined;
  }
}

function parseKernelVersion(
  value: string | undefined,
): SmartAccountKernelVersion | undefined {
  switch (value?.trim()) {
    case "0.2.1":
    case "0.2.2":
    case "0.2.3":
    case "0.2.4":
    case "0.3.0-beta":
    case "0.3.1":
    case "0.3.2":
    case "0.3.3":
      return value as SmartAccountKernelVersion;
    default:
      return undefined;
  }
}

function parseEntryPointVersion(
  value: string | undefined,
): SmartAccountEntryPointVersion | undefined {
  switch (value?.trim()) {
    case "0.6":
    case "0.7":
      return value as SmartAccountEntryPointVersion;
    default:
      return undefined;
  }
}

export function resolveSmartAccountKernelConfig(
  chainId: number,
): SmartAccountKernelConfig {
  const useMetaFactory = parseMetaFactoryMode(
    getEnv(
      withChainId(
        [
          "ARCENPAY_KERNEL_USE_META_FACTORY",
          "KERNEL_USE_META_FACTORY",
          "NEXT_PUBLIC_KERNEL_USE_META_FACTORY",
        ],
        chainId,
      ),
    ),
  );
  const entryPointVersion =
    parseEntryPointVersion(
      getEnv(
        withChainId(
          [
            "ARCENPAY_SMART_ACCOUNT_ENTRYPOINT_VERSION",
            "SMART_ACCOUNT_ENTRYPOINT_VERSION",
            "NEXT_PUBLIC_SMART_ACCOUNT_ENTRYPOINT_VERSION",
          ],
          chainId,
        ),
      ),
    ) ?? DEFAULT_ENTRYPOINT_VERSION;
  const version = parseKernelVersion(
    getEnv(
      withChainId(
        [
          "ARCENPAY_KERNEL_VERSION",
          "KERNEL_VERSION",
          "NEXT_PUBLIC_KERNEL_VERSION",
        ],
        chainId,
      ),
    ),
  );

  return {
    entryPointVersion,
    entryPointAddress:
      entryPointVersion === "0.6"
        ? entryPoint06Address
        : entryPoint07Address,
    version:
      version ??
      (entryPointVersion === "0.6"
        ? DEFAULT_KERNEL_VERSION_V06
        : DEFAULT_KERNEL_VERSION_V07),
    factoryAddress: getAddressEnv(
      [
        "ARCENPAY_KERNEL_FACTORY_ADDRESS",
        "KERNEL_FACTORY_ADDRESS",
        "NEXT_PUBLIC_KERNEL_FACTORY_ADDRESS",
      ],
      chainId,
    ),
    metaFactoryAddress: getAddressEnv(
      [
        "ARCENPAY_KERNEL_META_FACTORY_ADDRESS",
        "KERNEL_META_FACTORY_ADDRESS",
        "NEXT_PUBLIC_KERNEL_META_FACTORY_ADDRESS",
      ],
      chainId,
    ),
    accountLogicAddress: getAddressEnv(
      [
        "ARCENPAY_KERNEL_ACCOUNT_LOGIC_ADDRESS",
        "KERNEL_ACCOUNT_LOGIC_ADDRESS",
        "NEXT_PUBLIC_KERNEL_ACCOUNT_LOGIC_ADDRESS",
      ],
      chainId,
    ),
    validatorAddress: getAddressEnv(
      [
        "ARCENPAY_KERNEL_ECDSA_VALIDATOR_ADDRESS",
        "KERNEL_ECDSA_VALIDATOR_ADDRESS",
        "NEXT_PUBLIC_KERNEL_ECDSA_VALIDATOR_ADDRESS",
      ],
      chainId,
    ),
    useMetaFactory:
      useMetaFactory ??
      (chainId === ARC_TESTNET_CHAIN_ID ? false : undefined),
    verificationGasLimitFloor:
      getBigIntEnv(
        [
          "ARCENPAY_SMART_ACCOUNT_VERIFICATION_GAS_LIMIT",
          "SMART_ACCOUNT_VERIFICATION_GAS_LIMIT",
          "NEXT_PUBLIC_SMART_ACCOUNT_VERIFICATION_GAS_LIMIT",
        ],
        chainId,
      ) ??
      (chainId === ARC_TESTNET_CHAIN_ID
        ? ARC_TESTNET_VERIFICATION_GAS_FLOOR
        : undefined),
  };
}

export function applyVerificationGasFloor<T extends Record<string, unknown>>(
  request: T,
  floor: bigint | undefined,
): T {
  if (!floor) return request;

  const current =
    typeof request.verificationGasLimit === "bigint"
      ? request.verificationGasLimit
      : undefined;

  return {
    ...request,
    verificationGasLimit:
      current && current > floor ? current : floor,
  };
}
