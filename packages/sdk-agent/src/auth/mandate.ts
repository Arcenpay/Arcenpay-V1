// ============================================================
//  @arcenpay/agent — ArcenAuth Mandate System (Layer 3)
//  Signed, revocable delegation credentials (AAM) with EIP-712 /
//  Stellar Ed25519 signing and scope-narrowing delegation checks.
// ============================================================

import { randomUUID, createPublicKey, verify as cryptoVerify } from "node:crypto";
import {
  type Address,
  verifyTypedData,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@stellar/stellar-sdk";
import type {
  ArcenPayAgentMandate,
  MandateScope,
  MandateIssuer,
  MandateSubject,
  MandateRevocationConfig,
  HumanAttestation,
} from "../internal/core";
import { matchDomain } from "./policy";

export const MANDATE_DOMAIN_NAME = "ArcenPay Agent Mandate";
export const MANDATE_DOMAIN_VERSION = "1";
export const STELLAR_MANDATE_SIGNING_PREFIX = "ArcenPay Agent Mandate\n";
export const SOLANA_MANDATE_SIGNING_PREFIX = "ArcenPay Agent Mandate\n";

/** SPKI DER prefix for a raw ed25519 public key (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function verifyEd25519(
  rawPublicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawPublicKey)]),
    format: "der",
    type: "spki",
  });
  return cryptoVerify(null, message, publicKey, signature);
}

function isSolanaPrivateKey(privateKey: string): boolean {
  // EVM keys are 0x-prefixed 32-byte hex; Stellar keys are "S…" (56 chars).
  // Everything else (base58 ~88 chars, or a JSON byte array) is Solana.
  return (
    !privateKey.startsWith("0x") &&
    !/^S[A-Z2-7]{55}$/.test(privateKey) &&
    (privateKey.startsWith("[") || /^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(privateKey))
  );
}

export const MANDATE_EIP712_TYPES = {
  Mandate: [
    { name: "mandateId", type: "string" },
    { name: "issuerAddress", type: "address" },
    { name: "agentId", type: "string" },
    { name: "agentPublicKey", type: "string" },
    { name: "parentMandateId", type: "string" },
    { name: "maxPerTxn", type: "string" },
    { name: "maxDaily", type: "string" },
    { name: "maxTotal", type: "string" },
    { name: "validFrom", type: "string" },
    { name: "validUntil", type: "string" },
  ],
} as const;

export interface CreateMandateParams {
  mandateId?: string;
  issuer: MandateIssuer;
  subject: MandateSubject;
  scope: MandateScope;
  revocation?: MandateRevocationConfig;
  humanAttestation?: HumanAttestation | null;
}

/** Canonical stringify for consistent hashing and signing */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => canonicalJson(item)).join(",") + "]";
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson((obj as Record<string, unknown>)[key])}`,
  );
  return "{" + pairs.join(",") + "}";
}

function parseDecimalAmount(val?: string): bigint {
  if (!val) return 0n;
  try {
    return parseUnits(val.trim(), 6);
  } catch {
    return 0n;
  }
}

/**
 * Creates an unsigned ArcenPayAgentMandate structure with valid defaults.
 */
export function createAgentMandate(params: CreateMandateParams): Omit<ArcenPayAgentMandate, "signature"> {
  const mandateId = params.mandateId ?? `aam_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  return {
    type: "ArcenPayAgentMandate",
    version: "1.0",
    mandateId,
    issuer: params.issuer,
    subject: params.subject,
    scope: {
      allowedRecipients: ["*"],
      deniedRecipients: [],
      allowedTokens: ["USDC", "USDT"],
      ...params.scope,
      validFrom: params.scope?.validFrom ?? new Date().toISOString(),
      validUntil: params.scope?.validUntil ?? new Date(Date.now() + 86400 * 1000).toISOString(),
    },
    revocation: params.revocation ?? {
      method: "offchain_endpoint",
      checkUrl: `https://api.arcenpay.com/api/v1/mandates/${mandateId}/status`,
    },
    humanAttestation: params.humanAttestation ?? null,
    issuedAt: new Date().toISOString(),
  };
}

/**
 * Signs an ArcenPayAgentMandate using EIP-712 (for EVM) or Ed25519 (for Stellar).
 */
export async function signAgentMandate(
  mandate: Omit<ArcenPayAgentMandate, "signature">,
  privateKey: string,
  chainId?: number,
): Promise<ArcenPayAgentMandate> {
  const targetChainId = chainId ?? mandate.issuer.chainId;
  const isStellar =
    privateKey.startsWith("S") && privateKey.length === 56;

  if (isStellar) {
    const keypair = Keypair.fromSecret(privateKey);
    const payload = {
      mandateId: mandate.mandateId,
      issuer: mandate.issuer,
      subject: mandate.subject,
      scope: mandate.scope,
      issuedAt: mandate.issuedAt,
    };
    const message = Buffer.from(STELLAR_MANDATE_SIGNING_PREFIX + canonicalJson(payload));
    const signature = keypair.sign(message).toString("base64");
    return {
      ...mandate,
      signature: `stellar:${signature}`,
    };
  }

  if (isSolanaPrivateKey(privateKey)) {
    const [{ Keypair }, { parseSolanaSecretKey }] = await Promise.all([
      import("@solana/web3.js"),
      import("../internal/core/solana"),
    ]);
    const keypair = Keypair.fromSecretKey(
      parseSolanaSecretKey(privateKey),
    ) as unknown as { sign(message: Uint8Array): Uint8Array };
    const payload = {
      mandateId: mandate.mandateId,
      issuer: mandate.issuer,
      subject: mandate.subject,
      scope: mandate.scope,
      issuedAt: mandate.issuedAt,
    };
    const message = Buffer.from(
      SOLANA_MANDATE_SIGNING_PREFIX + canonicalJson(payload),
    );
    const signature = keypair.sign(message);
    return {
      ...mandate,
      signature: `solana:${Buffer.from(signature).toString("base64")}`,
    };
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const signature = await account.signTypedData({
    domain: {
      name: MANDATE_DOMAIN_NAME,
      version: MANDATE_DOMAIN_VERSION,
      chainId: targetChainId,
    },
    types: MANDATE_EIP712_TYPES,
    primaryType: "Mandate",
    message: {
      mandateId: mandate.mandateId,
      issuerAddress: mandate.issuer.address as Address,
      agentId: mandate.subject.agentId,
      agentPublicKey: mandate.subject.publicKey,
      parentMandateId: mandate.subject.parentMandateId ?? "",
      maxPerTxn: mandate.scope.maxPerTxn ?? "",
      maxDaily: mandate.scope.maxDaily ?? "",
      maxTotal: mandate.scope.maxTotal ?? "",
      validFrom: mandate.scope.validFrom,
      validUntil: mandate.scope.validUntil,
    },
  });

  return {
    ...mandate,
    signature,
  };
}

/**
 * Cryptographically verifies an ArcenPayAgentMandate signature and validity window.
 */
export async function verifyAgentMandate(
  mandate: ArcenPayAgentMandate,
  options?: {
    now?: Date;
    expectedIssuer?: string;
    expectedSubject?: string;
  },
): Promise<{ valid: boolean; reason?: string; recoveredIssuer?: string }> {
  const now = options?.now ?? new Date();

  // 1. Check validity period
  const validFrom = new Date(mandate.scope.validFrom).getTime();
  const validUntil = new Date(mandate.scope.validUntil).getTime();
  const currentTime = now.getTime();

  if (currentTime < validFrom) {
    return { valid: false, reason: `Mandate is not yet valid (validFrom: ${mandate.scope.validFrom})` };
  }
  if (currentTime > validUntil) {
    return { valid: false, reason: `Mandate has expired (validUntil: ${mandate.scope.validUntil})` };
  }

  // 2. Check expected identities if requested
  if (
    options?.expectedIssuer &&
    mandate.issuer.address.toLowerCase() !== options.expectedIssuer.toLowerCase()
  ) {
    return {
      valid: false,
      reason: `Issuer mismatch: expected ${options.expectedIssuer}, got ${mandate.issuer.address}`,
    };
  }

  if (
    options?.expectedSubject &&
    mandate.subject.agentId !== options.expectedSubject &&
    mandate.subject.publicKey.toLowerCase() !== options.expectedSubject.toLowerCase()
  ) {
    return {
      valid: false,
      reason: `Subject mismatch: expected ${options.expectedSubject}, got ${mandate.subject.agentId}`,
    };
  }

  // 3. Verify signature
  if (mandate.signature.startsWith("stellar:")) {
    const rawSig = mandate.signature.replace("stellar:", "");
    try {
      const keypair = Keypair.fromPublicKey(mandate.issuer.address);
      const payload = {
        mandateId: mandate.mandateId,
        issuer: mandate.issuer,
        subject: mandate.subject,
        scope: mandate.scope,
        issuedAt: mandate.issuedAt,
      };
      const message = Buffer.from(STELLAR_MANDATE_SIGNING_PREFIX + canonicalJson(payload));
      const ok = keypair.verify(message, Buffer.from(rawSig, "base64"));
      return ok
        ? { valid: true, recoveredIssuer: mandate.issuer.address }
        : { valid: false, reason: "Invalid Stellar Ed25519 mandate signature" };
    } catch (err: any) {
      return { valid: false, reason: `Stellar signature verification error: ${err?.message}` };
    }
  }

  if (mandate.signature.startsWith("solana:")) {
    const rawSig = mandate.signature.replace("solana:", "");
    try {
      const { decodeBase58 } = await import("../internal/core/solana");
      const payload = {
        mandateId: mandate.mandateId,
        issuer: mandate.issuer,
        subject: mandate.subject,
        scope: mandate.scope,
        issuedAt: mandate.issuedAt,
      };
      const message = Buffer.from(
        SOLANA_MANDATE_SIGNING_PREFIX + canonicalJson(payload),
      );
      const ok = verifyEd25519(
        decodeBase58(mandate.issuer.address),
        message,
        Buffer.from(rawSig, "base64"),
      );
      return ok
        ? { valid: true, recoveredIssuer: mandate.issuer.address }
        : { valid: false, reason: "Invalid Solana Ed25519 mandate signature" };
    } catch (err: any) {
      return { valid: false, reason: `Solana signature verification error: ${err?.message}` };
    }
  }

  try {
    const ok = await verifyTypedData({
      address: mandate.issuer.address as Address,
      domain: {
        name: MANDATE_DOMAIN_NAME,
        version: MANDATE_DOMAIN_VERSION,
        chainId: mandate.issuer.chainId,
      },
      types: MANDATE_EIP712_TYPES,
      primaryType: "Mandate",
      message: {
        mandateId: mandate.mandateId,
        issuerAddress: mandate.issuer.address as Address,
        agentId: mandate.subject.agentId,
        agentPublicKey: mandate.subject.publicKey,
        parentMandateId: mandate.subject.parentMandateId ?? "",
        maxPerTxn: mandate.scope.maxPerTxn ?? "",
        maxDaily: mandate.scope.maxDaily ?? "",
        maxTotal: mandate.scope.maxTotal ?? "",
        validFrom: mandate.scope.validFrom,
        validUntil: mandate.scope.validUntil,
      },
      signature: mandate.signature as `0x${string}`,
    });

    return ok
      ? { valid: true, recoveredIssuer: mandate.issuer.address }
      : { valid: false, reason: "Invalid EIP-712 mandate signature" };
  } catch (err: any) {
    return { valid: false, reason: `EIP-712 signature verification error: ${err?.message}` };
  }
}

/**
 * Validates a delegation chain link, guaranteeing that childScope is a strict or equal
 * subset of parentScope (child can narrow permissions, but never widen them).
 */
export function isScopeSubset(
  childScope: MandateScope,
  parentScope: MandateScope,
): { valid: boolean; reason?: string } {
  // 1. Time validity window containment
  const pFrom = new Date(parentScope.validFrom).getTime();
  const pUntil = new Date(parentScope.validUntil).getTime();
  const cFrom = new Date(childScope.validFrom).getTime();
  const cUntil = new Date(childScope.validUntil).getTime();

  if (cFrom < pFrom) {
    return {
      valid: false,
      reason: `Child mandate validFrom (${childScope.validFrom}) precedes parent validFrom (${parentScope.validFrom})`,
    };
  }
  if (cUntil > pUntil) {
    return {
      valid: false,
      reason: `Child mandate validUntil (${childScope.validUntil}) exceeds parent validUntil (${parentScope.validUntil})`,
    };
  }

  // 2. Spending limit ceilings
  if (parentScope.maxPerTxn && childScope.maxPerTxn) {
    if (parseDecimalAmount(childScope.maxPerTxn) > parseDecimalAmount(parentScope.maxPerTxn)) {
      return {
        valid: false,
        reason: `Child maxPerTxn (${childScope.maxPerTxn}) exceeds parent ceiling (${parentScope.maxPerTxn})`,
      };
    }
  } else if (parentScope.maxPerTxn && !childScope.maxPerTxn) {
    return {
      valid: false,
      reason: `Child mandate cannot be unbounded when parent has maxPerTxn limit (${parentScope.maxPerTxn})`,
    };
  }

  if (parentScope.maxDaily && childScope.maxDaily) {
    if (parseDecimalAmount(childScope.maxDaily) > parseDecimalAmount(parentScope.maxDaily)) {
      return {
        valid: false,
        reason: `Child maxDaily (${childScope.maxDaily}) exceeds parent ceiling (${parentScope.maxDaily})`,
      };
    }
  } else if (parentScope.maxDaily && !childScope.maxDaily) {
    return {
      valid: false,
      reason: `Child mandate cannot be unbounded when parent has maxDaily limit (${parentScope.maxDaily})`,
    };
  }

  if (parentScope.maxTotal && childScope.maxTotal) {
    if (parseDecimalAmount(childScope.maxTotal) > parseDecimalAmount(parentScope.maxTotal)) {
      return {
        valid: false,
        reason: `Child maxTotal (${childScope.maxTotal}) exceeds parent ceiling (${parentScope.maxTotal})`,
      };
    }
  } else if (parentScope.maxTotal && !childScope.maxTotal) {
    return {
      valid: false,
      reason: `Child mandate cannot be unbounded when parent has maxTotal limit (${parentScope.maxTotal})`,
    };
  }

  // 3. Allowed tokens containment
  if (parentScope.allowedTokens && parentScope.allowedTokens.length > 0) {
    const parentTokens = new Set(parentScope.allowedTokens.map((t) => t.toUpperCase()));
    for (const token of childScope.allowedTokens ?? []) {
      if (!parentTokens.has(token.toUpperCase())) {
        return {
          valid: false,
          reason: `Token "${token}" permitted in child mandate is not allowed by parent mandate`,
        };
      }
    }
  }

  // 4. Allowed chains containment
  if (parentScope.allowedChains && parentScope.allowedChains.length > 0) {
    const parentChains = new Set(parentScope.allowedChains);
    for (const chain of childScope.allowedChains ?? []) {
      if (!parentChains.has(chain)) {
        return {
          valid: false,
          reason: `Chain ID ${chain} permitted in child mandate is not allowed by parent mandate`,
        };
      }
    }
  }

  // 5. Allowed recipients containment
  const parentRecipients = parentScope.allowedRecipients ?? ["*"];
  const childRecipients = childScope.allowedRecipients ?? ["*"];

  if (!parentRecipients.includes("*")) {
    if (childRecipients.includes("*")) {
      return {
        valid: false,
        reason: "Child cannot allow wildcard recipients when parent specifies explicit recipients",
      };
    }
    const parentSet = new Set(parentRecipients.map((r) => r.toLowerCase()));
    for (const recipient of childRecipients) {
      if (!parentSet.has(recipient.toLowerCase())) {
        return {
          valid: false,
          reason: `Recipient "${recipient}" in child mandate is not permitted by parent mandate`,
        };
      }
    }
  }

  // 6. Denied recipients inheritance
  const childDenied = new Set((childScope.deniedRecipients ?? []).map((r) => r.toLowerCase()));
  for (const denied of parentScope.deniedRecipients ?? []) {
    if (!childDenied.has(denied.toLowerCase())) {
      return {
        valid: false,
        reason: `Child mandate must maintain denied recipient "${denied}" from parent mandate`,
      };
    }
  }

  // 7. Allowed resource domains containment
  if (parentScope.allowedResourceDomains && parentScope.allowedResourceDomains.length > 0) {
    if (!parentScope.allowedResourceDomains.includes("*")) {
      if (!childScope.allowedResourceDomains || childScope.allowedResourceDomains.includes("*")) {
        return {
          valid: false,
          reason: "Child cannot allow wildcard resource domains when parent specifies explicit domains",
        };
      }
      for (const domain of childScope.allowedResourceDomains) {
        const permitted = parentScope.allowedResourceDomains.some((pDomain) => matchDomain(domain, pDomain));
        if (!permitted) {
          return {
            valid: false,
            reason: `Resource domain "${domain}" in child mandate is not permitted by parent mandate`,
          };
        }
      }
    }
  }

  return { valid: true };
}
