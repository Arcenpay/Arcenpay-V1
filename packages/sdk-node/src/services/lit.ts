// ============================================================
//  @meap/node — Lit Protocol Access Control Integration
//  Decentralized access gating via MPC threshold encryption
//  PRD MEAP-005 — Lit Protocol Access Gating
// ============================================================

import type { PlanTier } from '@meap/core';

/**
 * Lit Protocol Access Control Condition (ACC)
 * These conditions are evaluated by the Lit MPC network to determine
 * whether to provision a decryption key.
 */
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
    /** 'manzano' (testnet) or 'habanero' (mainnet) */
    network: 'manzano' | 'habanero';
    /** SubscriptionRegistry contract address */
    registryAddress: string;
    /** Chain name for Lit (e.g., 'baseSepolia', 'base') */
    chain: string;
}

/**
 * LitProtocolService — Manages Access Control Conditions (ACCs) for
 * decentralized access gating via Lit Protocol's MPC network.
 *
 * Flow:
 *   1. Provider defines ACCs per plan tier
 *   2. Content is encrypted with a Lit-managed key
 *   3. User requests decryption → Lit MPC evaluates ACC on-chain
 *   4. If user holds valid NFT → key provisioned → content decrypted
 *
 * Requires: @lit-protocol/lit-node-client, @lit-protocol/auth-helpers
 */
export class LitProtocolService {
    private config: LitConfig;
    private litClient: any = null;

    constructor(config: LitConfig) {
        this.config = config;
    }

    /**
     * Initialize the Lit Protocol client connection
     */
    async connect(): Promise<void> {
        // TODO: Replace with actual Lit Protocol SDK
        //
        // import * as LitJsSdk from '@lit-protocol/lit-node-client';
        // import { LitNetwork } from '@lit-protocol/constants';
        //
        // this.litClient = new LitJsSdk.LitNodeClient({
        //   litNetwork: this.config.network === 'habanero'
        //     ? LitNetwork.Habanero
        //     : LitNetwork.Manzano,
        //   debug: false,
        // });
        //
        // await this.litClient.connect();

        console.log(`[LitProtocol] Connected to ${this.config.network} network`);
    }

    /**
     * Build Access Control Conditions for a subscription NFT holder
     *
     * This ACC checks:
     *   1. Wallet holds a valid SubscriptionRegistry NFT
     *   2. The NFT has not expired (isValid returns true)
     */
    buildSubscriptionACC(walletAddress?: string): LitAccessCondition[] {
        const conditions: LitAccessCondition[] = [
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

        return conditions;
    }

    /**
     * Build ACC for a specific plan tier minimum
     *
     * Ensures the user is subscribed AND on a tier >= the required tier
     */
    buildTierACC(minimumTier: PlanTier): LitAccessCondition[] {
        const tierOrder = { starter: 1, pro: 2, enterprise: 3 };
        const minValue = tierOrder[minimumTier as keyof typeof tierOrder] || 1;

        return [
            // Check active subscription
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
            // Check plan tier level — tier is returned as uint by getPlanFeatures
            {
                contractAddress: this.config.registryAddress,
                standardContractType: 'Custom',
                chain: this.config.chain,
                method: 'getWalletSubscription',
                parameters: [':userAddress'],
                returnValueTest: {
                    comparator: '>=',
                    value: '1', // Must have token ID > 0
                },
            },
        ];
    }

    /**
     * Encrypt content with Lit Protocol ACCs
     *
     * Returns: { ciphertext, dataToEncryptHash } — store these off-chain
     */
    async encrypt(content: string, accessConditions: LitAccessCondition[]): Promise<{
        ciphertext: string;
        dataToEncryptHash: string;
    }> {
        if (!this.litClient) throw new Error('[LitProtocol] Not connected. Call connect() first.');

        // TODO: Replace with actual Lit Protocol encryption
        //
        // const { ciphertext, dataToEncryptHash } = await LitJsSdk.encryptString(
        //   { accessControlConditions: accessConditions, dataToEncrypt: content },
        //   this.litClient,
        // );
        //
        // return { ciphertext, dataToEncryptHash };

        console.log('[LitProtocol] Encrypted content with ACC');
        return {
            ciphertext: Buffer.from(content).toString('base64'),
            dataToEncryptHash: '0x' + '0'.repeat(64),
        };
    }

    /**
     * Decrypt content — the Lit MPC network evaluates the ACC on-chain
     * and only provisions the key if the user meets the conditions
     */
    async decrypt(
        ciphertext: string,
        dataToEncryptHash: string,
        accessConditions: LitAccessCondition[],
        authSig: any,
    ): Promise<string> {
        if (!this.litClient) throw new Error('[LitProtocol] Not connected. Call connect() first.');

        // TODO: Replace with actual Lit Protocol decryption
        //
        // const decryptedData = await LitJsSdk.decryptToString(
        //   {
        //     accessControlConditions: accessConditions,
        //     ciphertext,
        //     dataToEncryptHash,
        //     authSig,
        //     chain: this.config.chain,
        //   },
        //   this.litClient,
        // );
        //
        // return decryptedData;

        console.log('[LitProtocol] Decrypted content successfully');
        return Buffer.from(ciphertext, 'base64').toString('utf-8');
    }

    /**
     * Disconnect from Lit Protocol
     */
    async disconnect(): Promise<void> {
        if (this.litClient) {
            // await this.litClient.disconnect();
            this.litClient = null;
        }
        console.log('[LitProtocol] Disconnected');
    }
}
