// ============================================================
//  @arcenpay/node — Lit Protocol Access Control Integration
// ============================================================

import { LIT_NETWORK } from '@lit-protocol/constants';
import { decryptToString, encryptString } from '@lit-protocol/encryption';
import { LitNodeClient } from '@lit-protocol/lit-node-client';
import type { PlanTier } from '@arcenpay/sdk';

export interface LitAccessCondition {
  contractAddress: string;
  standardContractType: 'ERC721' | 'ERC1155' | 'Custom';
  chain: string;
  method: string;
  parameters: string[];
  returnValueTest: {
    comparator: '>' | '<' | '=' | '>=' | '<=';
    value: string;
  };
}

export interface LitConfig {
  /** 'manzano' (legacy testnet alias) or 'habanero' (legacy mainnet alias) */
  network: 'manzano' | 'habanero';
  /** SubscriptionRegistry contract address */
  registryAddress: string;
  /** Chain name used in ACC conditions (e.g., 'baseSepolia', 'base', 'sepolia') */
  chain: string;
}

type LitAuthInput = {
  authSig?: unknown;
  sessionSigs?: unknown;
};

export class LitProtocolService {
  private config: LitConfig;
  private litClient: LitNodeClient | null = null;

  constructor(config: LitConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    const litNetwork =
      this.config.network === 'habanero'
        ? LIT_NETWORK.Datil
        : LIT_NETWORK.DatilTest;

    this.litClient = new LitNodeClient({
      litNetwork,
      debug: false,
    });

    await this.litClient.connect();
    console.log(`[LitProtocol] Connected to ${litNetwork}`);
  }

  buildSubscriptionACC(_walletAddress?: string): LitAccessCondition[] {
    return [
      {
        contractAddress: this.config.registryAddress,
        standardContractType: 'Custom',
        chain: this.config.chain,
        method: 'hasActiveSubscription',
        parameters: [':userAddress'],
        returnValueTest: {
          comparator: '=',
          value: 'true',
        },
      },
    ];
  }

  buildTierACC(minimumTier: PlanTier): LitAccessCondition[] {
    const tierOrder = { starter: 1, pro: 2, enterprise: 3 } as const;
    const minValue = tierOrder[minimumTier as keyof typeof tierOrder] || 1;

    return [
      {
        contractAddress: this.config.registryAddress,
        standardContractType: 'Custom',
        chain: this.config.chain,
        method: 'hasActiveSubscription',
        parameters: [':userAddress'],
        returnValueTest: {
          comparator: '=',
          value: 'true',
        },
      },
      {
        contractAddress: this.config.registryAddress,
        standardContractType: 'Custom',
        chain: this.config.chain,
        method: 'getWalletSubscription',
        parameters: [':userAddress'],
        returnValueTest: {
          comparator: '>=',
          value: String(minValue > 0 ? 1 : 0),
        },
      },
    ];
  }

  async encrypt(
    content: string,
    accessConditions: LitAccessCondition[],
  ): Promise<{ ciphertext: string; dataToEncryptHash: string }> {
    this.ensureConnected();

    const result = await encryptString(
      {
        accessControlConditions: accessConditions as any,
        chain: this.config.chain as any,
        dataToEncrypt: content,
      } as any,
      this.litClient as any,
    );

    return {
      ciphertext: result.ciphertext,
      dataToEncryptHash: result.dataToEncryptHash,
    };
  }

  async decrypt(
    ciphertext: string,
    dataToEncryptHash: string,
    accessConditions: LitAccessCondition[],
    auth: LitAuthInput,
  ): Promise<string> {
    this.ensureConnected();

    if (!auth?.authSig && !auth?.sessionSigs) {
      throw new Error(
        '[LitProtocol] Missing auth input. Provide authSig or sessionSigs for decryption.',
      );
    }

    const decrypted = await decryptToString(
      {
        accessControlConditions: accessConditions as any,
        chain: this.config.chain as any,
        ciphertext,
        dataToEncryptHash,
        ...(auth.authSig ? { authSig: auth.authSig } : {}),
        ...(auth.sessionSigs ? { sessionSigs: auth.sessionSigs } : {}),
      } as any,
      this.litClient as any,
    );

    return decrypted;
  }

  async disconnect(): Promise<void> {
    if (this.litClient) {
      await this.litClient.disconnect();
      this.litClient = null;
    }
    console.log('[LitProtocol] Disconnected');
  }

  private ensureConnected(): void {
    if (!this.litClient) {
      throw new Error('[LitProtocol] Not connected. Call connect() first.');
    }
  }
}
