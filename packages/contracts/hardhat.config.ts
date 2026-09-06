import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-viem";
import * as dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo",
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 11155111,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 84532,
    },
    baseMainnet: {
      url: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 8453,
    },
    arcTestnet: {
      url: process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network",
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 5042002,
    },
    // BOT Chain — EVM-compatible L1 (Parlia/BSC-style consensus, same family
    // as BSC). No Solidity changes needed; this deploys the exact same
    // artifacts used on the other EVM networks above.
    //
    // NOTE: this network entry is only used for deployment (signing +
    // broadcasting transactions), which works fine against the default
    // public RPC. It is UNRELATED to the facilitator's runtime RPC choice —
    // BOT Chain's own docs state `eth_getLogs` is disabled on this same
    // public endpoint, which matters for apps/facilitator (event polling),
    // not for `hardhat run` deploy scripts. See apps/facilitator/.env.example
    // for the runtime RPC override before running the facilitator against
    // BOT Chain in production.
    botTestnet: {
      url: process.env.BOT_TESTNET_RPC_URL || "https://rpc.bohr.life",
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 968,
    },
    botMainnet: {
      url: process.env.BOT_MAINNET_RPC_URL || "https://rpc.botchain.ai",
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 677,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      baseSepolia: process.env.ETHERSCAN_API_KEY || "",
      baseMainnet: process.env.ETHERSCAN_API_KEY || "",
      // BOT Chain's explorer (scan.botchain.ai) is Blockscout-based and
      // exposes an Etherscan-compatible verification API. Self-hosted
      // Blockscout instances typically accept any non-empty string here.
      botMainnet: process.env.BOTSCAN_API_KEY || "no-api-key-needed",
      botTestnet: process.env.BOTSCAN_API_KEY || "no-api-key-needed",
    },
    customChains: [
      {
        network: "botTestnet",
        chainId: 968,
        urls: {
          apiURL: "https://scan.bohr.life/api",
          browserURL: "https://scan.bohr.life",
        },
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "baseMainnet",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "botMainnet",
        chainId: 677,
        urls: {
          apiURL: "https://scan.botchain.ai/api",
          browserURL: "https://scan.botchain.ai",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache_hardhat",
    artifacts: "./artifacts",
  },
};

export default config;
