'use client';

import React, { useState, useCallback } from 'react';
import { useMEAP } from '../providers/MEAPProvider';

// ============================================================
//  CheckoutModal — Wallet connect + Smart Account + Autopay
//  Handles the full subscription checkout flow
// ============================================================

type CheckoutStep = 'connect' | 'account' | 'approve' | 'subscribe' | 'success' | 'error';

interface CheckoutModalProps {
  planId: bigint;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (tokenId: bigint) => void;
  onError?: (error: Error) => void;
  className?: string;
}

/**
 * CheckoutModal — Full subscription checkout flow
 *
 * Flow:
 * 1. Connect wallet (if not connected)
 * 2. Deploy ERC-7579 smart account (if needed)
 * 3. Approve USDC spending
 * 4. Install Autopay Module & mint subscription NFT
 * 5. Success!
 *
 * @example
 * ```tsx
 * <CheckoutModal
 *   planId={1n}
 *   isOpen={showCheckout}
 *   onClose={() => setShowCheckout(false)}
 *   onSuccess={(tokenId) => console.log('Subscribed!', tokenId)}
 * />
 * ```
 */
export function CheckoutModal({
  planId,
  isOpen,
  onClose,
  onSuccess,
  onError,
  className = '',
}: CheckoutModalProps) {
  const { contracts, isTestnet } = useMEAP();
  const [step, setStep] = useState<CheckoutStep>('connect');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO: Integrate wagmi useConnect hook
      // For now, simulate wallet connection
      setStep('account');
    } catch (err: any) {
      setError(err.message);
      setStep('error');
      onError?.(err);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const handleDeployAccount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO: Deploy ERC-7579 smart account via ZeroDev SDK
      // 1. Check if user already has a smart account
      // 2. If not, deploy one via ZeroDev Kernel
      // 3. Verify deployment was successful
      setStep('approve');
    } catch (err: any) {
      setError(err.message);
      setStep('error');
      onError?.(err);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const handleApprove = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO: Approve USDC spending for the Autopay Module
      // 1. Get plan price from PlanFactory
      // 2. Request ERC-20 approval for Autopay Module contract
      setStep('subscribe');
    } catch (err: any) {
      setError(err.message);
      setStep('error');
      onError?.(err);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const handleSubscribe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO: Install Autopay Module and execute first billing
      // 1. Encode AutopayConfig
      // 2. Install module on smart account via ERC-7579 interface
      // 3. Execute first billing pull
      // 4. Verify subscription NFT was minted
      setStep('success');
      onSuccess?.(1n); // Placeholder tokenId
    } catch (err: any) {
      setError(err.message);
      setStep('error');
      onError?.(err);
    } finally {
      setLoading(false);
    }
  }, [onSuccess, onError]);

  if (!isOpen) return null;

  const STEP_CONFIG: Record<CheckoutStep, { title: string; description: string; action?: () => void; actionLabel?: string }> = {
    connect: {
      title: 'Connect Wallet',
      description: 'Connect your wallet to start the subscription process.',
      action: handleConnect,
      actionLabel: 'Connect Wallet',
    },
    account: {
      title: 'Smart Account Setup',
      description: 'We\'ll set up an ERC-7579 smart account for automated billing. This is a one-time setup.',
      action: handleDeployAccount,
      actionLabel: 'Deploy Smart Account',
    },
    approve: {
      title: 'Approve USDC',
      description: 'Approve the subscription billing contract to debit USDC from your smart account.',
      action: handleApprove,
      actionLabel: 'Approve USDC',
    },
    subscribe: {
      title: 'Confirm Subscription',
      description: 'Install the autopay module and start your subscription. You can cancel anytime.',
      action: handleSubscribe,
      actionLabel: 'Subscribe Now',
    },
    success: {
      title: '🎉 Subscription Active!',
      description: 'Your subscription NFT has been minted. You now have access to all premium features.',
    },
    error: {
      title: 'Something went wrong',
      description: error || 'An unexpected error occurred. Please try again.',
    },
  };

  const currentStep = STEP_CONFIG[step];
  const stepNumber = ['connect', 'account', 'approve', 'subscribe'].indexOf(step) + 1;

  return (
    <div className={`meap-checkout-overlay ${className}`} onClick={onClose}>
      <div className="meap-checkout-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="meap-checkout-header">
          <h2>{currentStep.title}</h2>
          <button className="meap-checkout-close" onClick={onClose}>✕</button>
        </div>

        {/* Progress */}
        {step !== 'success' && step !== 'error' && (
          <div className="meap-checkout-progress">
            {['connect', 'account', 'approve', 'subscribe'].map((s, i) => (
              <div
                key={s}
                className={`meap-checkout-step ${i + 1 <= stepNumber ? 'active' : ''} ${i + 1 < stepNumber ? 'completed' : ''}`}
              >
                <div className="meap-step-dot">{i + 1 < stepNumber ? '✓' : i + 1}</div>
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="meap-checkout-body">
          <p>{currentStep.description}</p>

          {isTestnet && (
            <div className="meap-testnet-badge">
              🔧 Testnet Mode (Base Sepolia)
            </div>
          )}

          {txHash && (
            <div className="meap-tx-hash">
              <a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer">
                View Transaction →
              </a>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="meap-checkout-actions">
          {currentStep.action && (
            <button
              className="meap-checkout-btn primary"
              onClick={currentStep.action}
              disabled={loading}
            >
              {loading ? 'Processing...' : currentStep.actionLabel}
            </button>
          )}

          {step === 'success' && (
            <button className="meap-checkout-btn primary" onClick={onClose}>
              Done
            </button>
          )}

          {step === 'error' && (
            <button
              className="meap-checkout-btn secondary"
              onClick={() => setStep('connect')}
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
