"use client";

import React, { type ReactNode, useEffect, useMemo, useState } from "react";
import { useEntitlement } from "../hooks/useEntitlement";
import { useArcenPay } from "../providers/ArcenPayProvider";
import {
  getLitNodeClient,
  getCachedSessionSigs,
  cacheSessionSigs,
} from "../lib/lit-client";

interface FeatureFlagGuardProps {
  featureKey: string;
  walletAddress: string;
  children: ReactNode;
  fallback?: ReactNode;
  className?: string;
  /** Require a successful Lit decrypt probe in addition to feature entitlement. */
  requireDecryption?: boolean;
  /**
   * Optional Lit decrypt endpoint (HTTP proxy mode).
   * Supports `{wallet}` and `{feature}` placeholders.
   * If omitted and requireDecryption=true, falls back to direct Lit SDK.
   */
  decryptEndpoint?: string;
  /** Optional request payload merged into the decryption request body. */
  decryptPayload?: Record<string, unknown>;
  onDecryptionSuccess?: (result: unknown) => void;
  onDecryptionError?: (error: Error) => void;
}

export function resolveDecryptEndpoint(
  endpointTemplate: string | null | undefined,
  walletAddress: string,
  featureKey: string,
): string | null {
  if (!endpointTemplate) return null;
  return endpointTemplate
    .replace("{wallet}", walletAddress.toLowerCase())
    .replace("{feature}", featureKey);
}

export function hasEntitlementFeature(
  isSubscribed: boolean,
  features: Record<string, boolean | string | number>,
  featureKey: string,
): boolean {
  return isSubscribed && features[featureKey] === true;
}

export function FeatureFlagGuard({
  featureKey,
  walletAddress,
  children,
  fallback = null,
  className = "",
  requireDecryption = false,
  decryptEndpoint,
  decryptPayload,
  onDecryptionSuccess,
  onDecryptionError,
}: FeatureFlagGuardProps) {
  const { config } = useArcenPay();
  const { features, isSubscribed, isLoading } = useEntitlement(
    walletAddress,
    featureKey,
  );
  const [decrypting, setDecrypting] = useState(false);
  const [decryptPassed, setDecryptPassed] = useState(false);
  const [decryptError, setDecryptError] = useState<Error | null>(null);

  const resolvedDecryptEndpoint = useMemo(() => {
    const raw =
      decryptEndpoint ||
      (config.tablelandConfig?.providerUrl
        ? `${config.tablelandConfig.providerUrl.replace(/\/$/, "")}/api/lit/decrypt`
        : null);
    if (!raw) return null;
    return resolveDecryptEndpoint(raw, walletAddress, featureKey);
  }, [
    config.tablelandConfig?.providerUrl,
    decryptEndpoint,
    featureKey,
    walletAddress,
  ]);

  const hasFeature = hasEntitlementFeature(isSubscribed, features, featureKey);

  useEffect(() => {
    if (!requireDecryption) {
      setDecryptPassed(true);
      setDecryptError(null);
      return;
    }

    if (!hasFeature) {
      setDecryptPassed(false);
      setDecryptError(null);
      return;
    }

    let cancelled = false;
    setDecrypting(true);
    setDecryptError(null);

    void (async () => {
      try {
        if (resolvedDecryptEndpoint) {
          // ── Path A: HTTP proxy ────────────────────────────────────────────
          const response = await fetch(resolvedDecryptEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              walletAddress,
              featureKey,
              ...decryptPayload,
            }),
          });

          if (!response.ok) {
            throw new Error(`Decrypt request failed (${response.status})`);
          }

          const payload = (await response.json()) as {
            ok?: boolean;
            error?: string;
          };
          if (payload.ok !== true) {
            throw new Error(payload.error || "Decrypt request failed.");
          }

          if (cancelled) return;
          setDecryptPassed(true);
          onDecryptionSuccess?.(payload);
        } else {
          // ── Path B: Direct Lit Protocol SDK ──────────────────────────────
          const litNetwork =
            (config.litNetwork as "habanero" | "manzano") ?? "habanero";
          const client = await getLitNodeClient(litNetwork);

          // Retrieve or create session signatures (24h cache)
          let sessionSigs = getCachedSessionSigs();
          if (!sessionSigs) {
            const authHelpers = await import("@lit-protocol/auth-helpers");
            // generateAuthSig is the supported API in newer versions
            const generateAuthSig =
              (authHelpers as any).generateAuthSig ??
              (authHelpers as any).checkAndSignAuthMessage;

            if (!generateAuthSig) {
              throw new Error(
                "[FeatureFlagGuard] Install @lit-protocol/auth-helpers to use direct Lit SDK mode.",
              );
            }

            const authSig = await generateAuthSig({ chain: "ethereum" });

            sessionSigs = await client.getSessionSigs({
              chain: "ethereum",
              authNeededCallback: async (_params: unknown) => authSig,
              expiration: new Date(
                Date.now() + 24 * 60 * 60 * 1000,
              ).toISOString(),
              resourceAbilityRequests: [],
            });
            cacheSessionSigs(sessionSigs);
          }

          // Access Control Condition: wallet address must match
          const accessControlConditions = [
            {
              contractAddress: "",
              standardContractType: "",
              chain: "ethereum",
              method: "",
              parameters: [":userAddress"],
              returnValueTest: {
                comparator: "=",
                value: walletAddress.toLowerCase(),
              },
            },
          ];

          await client.getEncryptionKey({
            accessControlConditions,
            toDecrypt: features[`${featureKey}_ciphertext`] as
              | string
              | undefined,
            chain: "ethereum",
            authSig: null,
            sessionSigs,
          });

          if (cancelled) return;
          setDecryptPassed(true);
          onDecryptionSuccess?.({ ok: true, via: "lit-sdk" });
        }
      } catch (err) {
        if (cancelled) return;
        const normalized =
          err instanceof Error ? err : new Error("Decrypt request failed.");
        setDecryptPassed(false);
        setDecryptError(normalized);
        onDecryptionError?.(normalized);
      } finally {
        if (!cancelled) {
          setDecrypting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    config.litNetwork,
    decryptPayload,
    featureKey,
    features,
    hasFeature,
    onDecryptionError,
    onDecryptionSuccess,
    requireDecryption,
    resolvedDecryptEndpoint,
    walletAddress,
  ]);

  if (isLoading || (requireDecryption && decrypting)) {
    return (
      <div className={`arcenpay-guard-loading ${className}`}>
        <div className="arcenpay-spinner" />
      </div>
    );
  }

  if (hasFeature && (!requireDecryption || decryptPassed)) {
    return <>{children}</>;
  }

  if (decryptError) {
    return <>{fallback}</>;
  }

  return <>{fallback}</>;
}
