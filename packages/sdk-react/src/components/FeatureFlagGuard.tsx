'use client';

import React, { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useEntitlement } from '../hooks/useEntitlement';
import { useMEAP } from '../providers/MEAPProvider';

interface FeatureFlagGuardProps {
  featureKey: string;
  walletAddress: string;
  children: ReactNode;
  fallback?: ReactNode;
  className?: string;
  /** Require a successful Lit decrypt probe in addition to feature entitlement. */
  requireDecryption?: boolean;
  /**
   * Optional Lit decrypt endpoint.
   * Supports `{wallet}` and `{feature}` placeholders.
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
    .replace('{wallet}', walletAddress.toLowerCase())
    .replace('{feature}', featureKey);
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
  className = '',
  requireDecryption = false,
  decryptEndpoint,
  decryptPayload,
  onDecryptionSuccess,
  onDecryptionError,
}: FeatureFlagGuardProps) {
  const { config } = useMEAP();
  const { features, isSubscribed, isLoading } = useEntitlement(walletAddress, featureKey);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptPassed, setDecryptPassed] = useState(false);
  const [decryptError, setDecryptError] = useState<Error | null>(null);

  const resolvedDecryptEndpoint = useMemo(() => {
    const raw =
      decryptEndpoint ||
      config.litConfig?.decryptEndpoint ||
      (config.tablelandConfig?.providerUrl
        ? `${config.tablelandConfig.providerUrl.replace(/\/$/, '')}/api/lit/decrypt`
        : null);
    if (!raw) return null;
    return resolveDecryptEndpoint(raw, walletAddress, featureKey);
  }, [
    config.litConfig?.decryptEndpoint,
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

    if (!resolvedDecryptEndpoint) {
      const err = new Error(
        'FeatureFlagGuard: decryption required but no decrypt endpoint configured.',
      );
      setDecryptError(err);
      setDecryptPassed(false);
      onDecryptionError?.(err);
      return;
    }

    let cancelled = false;
    setDecrypting(true);
    setDecryptError(null);

    void (async () => {
      try {
        const response = await fetch(resolvedDecryptEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
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
          throw new Error(payload.error || 'Decrypt request failed.');
        }

        if (cancelled) return;
        setDecryptPassed(true);
        onDecryptionSuccess?.(payload);
      } catch (err) {
        if (cancelled) return;
        const normalized =
          err instanceof Error ? err : new Error('Decrypt request failed.');
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
    decryptPayload,
    featureKey,
    hasFeature,
    onDecryptionError,
    onDecryptionSuccess,
    requireDecryption,
    resolvedDecryptEndpoint,
    walletAddress,
  ]);

  if (isLoading || (requireDecryption && decrypting)) {
    return (
      <div className={`meap-guard-loading ${className}`}>
        <div className="meap-spinner" />
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
