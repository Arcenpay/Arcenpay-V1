// ============================================================
//  @arcenpay/agent — Verify-Then-Settle Escrow Engine (Section 11)
//  Deterministic verification for exact_hash, schema_conformance,
//  and attestation commit-reveal escrow deliverables.
// ============================================================

import { createHash } from "node:crypto";
import type {
  ProviderCommitment,
  EscrowMode,
  DisputeReason,
} from "../internal/core";
import { canonicalJson } from "../auth/mandate";

/**
 * Computes deterministic SHA-256 hash string for any JS payload.
 */
export function computeExactHash(payload: unknown): string {
  let content: string;
  if (typeof payload === "string") {
    content = payload;
  } else if (Buffer.isBuffer(payload)) {
    content = payload.toString("utf8");
  } else {
    content = canonicalJson(payload);
  }
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Validates payload against JSON schema descriptor constraints (required fields, types, freshness).
 */
export function checkSchemaConformance(
  payload: unknown,
  schemaDescriptor?: Record<string, unknown> | null,
): { valid: boolean; error?: string; errorDetail?: string } {
  if (!schemaDescriptor || Object.keys(schemaDescriptor).length === 0) {
    return { valid: true };
  }

  if (payload === null || typeof payload !== "object") {
    const err = `Payload must be an object, received ${typeof payload}`;
    return { valid: false, error: err, errorDetail: err };
  }

  const obj = payload as Record<string, unknown>;

  // Check required fields
  const required = schemaDescriptor.required;
  if (Array.isArray(required)) {
    for (const field of required) {
      if (typeof field === "string") {
        if (obj[field] === undefined || obj[field] === null) {
          const err = `Missing required property "${field}"`;
          return { valid: false, error: err, errorDetail: err };
        }
      }
    }
  }

  // Check property types
  const properties = schemaDescriptor.properties;
  if (properties && typeof properties === "object") {
    for (const [propName, propDef] of Object.entries(properties as Record<string, unknown>)) {
      const val = obj[propName];
      if (val !== undefined && val !== null && typeof propDef === "object" && propDef !== null) {
        const expectedType = (propDef as any).type;
        if (expectedType && typeof expectedType === "string") {
          const actualType = Array.isArray(val) ? "array" : typeof val;
          if (actualType !== expectedType) {
            const err = `Expected type '${expectedType}' for property "${propName}", got "${actualType}"`;
            return {
              valid: false,
              error: err,
              errorDetail: err,
            };
          }
        }
      }
    }
  }

  // Check freshness window if specified (maxAgeSeconds)
  const maxAgeSeconds = schemaDescriptor.maxAgeSeconds;
  if (typeof maxAgeSeconds === "number") {
    const timestampField = (schemaDescriptor.timestampField as string) || "timestamp";
    const rawTs = obj[timestampField];
    if (rawTs) {
      const tsTime = new Date(String(rawTs)).getTime();
      if (!isNaN(tsTime)) {
        const ageSeconds = (Date.now() - tsTime) / 1000;
        if (ageSeconds > maxAgeSeconds) {
          const err = `Payload age exceeds maxAgeSeconds: ${Math.round(ageSeconds)}s > ${maxAgeSeconds}s`;
          return {
            valid: false,
            error: err,
            errorDetail: err,
          };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Core verification function for Verify-Then-Settle commit-reveal deliverables.
 */
export function verifyCommitment(
  commitment: ProviderCommitment,
  payload: unknown,
  schemaDescriptor?: Record<string, unknown> | null,
): { valid: boolean; failureReason?: DisputeReason; errorDetail?: string } {
  if (!commitment || !commitment.commitment) {
    return { valid: false, failureReason: "non_delivery", errorDetail: "Missing provider commitment" };
  }

  switch (commitment.mode) {
    case "exact_hash": {
      const actualHash = computeExactHash(payload);
      const expectedHash = commitment.commitment.startsWith("sha256:")
        ? commitment.commitment.slice(7)
        : commitment.commitment;

      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        return {
          valid: false,
          failureReason: "hash_mismatch",
          errorDetail: `Hash mismatch: expected ${expectedHash}, computed ${actualHash}`,
        };
      }
      return { valid: true };
    }

    case "schema_conformance": {
      const schemaCheck = checkSchemaConformance(payload, schemaDescriptor);
      if (!schemaCheck.valid) {
        return {
          valid: false,
          failureReason: "schema_violation",
          errorDetail: schemaCheck.errorDetail,
        };
      }
      return { valid: true };
    }

    case "attestation": {
      // Basic sample check: if payload is array, ensure it contains items
      if (Array.isArray(payload) && payload.length === 0) {
        return {
          valid: false,
          failureReason: "sample_contradiction",
          errorDetail: "Attestation sample contains zero records",
        };
      }
      return { valid: true };
    }

    default:
      return {
        valid: false,
        failureReason: "schema_violation",
        errorDetail: `Unsupported commitment mode: ${(commitment as any).mode}`,
      };
  }
}

/**
 * Creates a provider commitment structure for test or merchant use.
 */
export function createProviderCommitment(params: {
  requestNonce: string;
  resourceId: string;
  mode: EscrowMode;
  payload?: unknown;
  payloadOrHash?: unknown;
  commitment?: string;
  providerSignature?: string;
}): ProviderCommitment {
  const target = params.payload ?? params.payloadOrHash;
  let commitmentStr: string;
  if (params.commitment) {
    commitmentStr = params.commitment;
  } else if (params.mode === "exact_hash") {
    if (typeof target === "string" && /^[0-9a-f]{64}$/i.test(target)) {
      commitmentStr = `sha256:${target}`;
    } else if (typeof target === "string" && target.startsWith("sha256:")) {
      commitmentStr = target;
    } else {
      commitmentStr = `sha256:${computeExactHash(target)}`;
    }
  } else {
    commitmentStr = `schema:${computeExactHash(target).slice(0, 16)}`;
  }

  return {
    type: "ArcenProviderCommitment",
    requestNonce: params.requestNonce,
    resourceId: params.resourceId,
    mode: params.mode,
    commitment: commitmentStr,
    timestamp: new Date().toISOString(),
    providerSignature: params.providerSignature ?? "0xmock_provider_sig",
  };
}
