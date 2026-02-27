'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  useAccount,
  useConnect,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import { parseUnits } from 'viem';
import {
  PlanFactoryABI,
  SubscriptionRegistryABI,
  getContractAddresses,
  TOKENS,
} from '@meap/core';
import { useMEAP } from '../providers/MEAPProvider';

// ============================================================
//  CheckoutModal — Wallet connect + Smart Account + Autopay
//  Handles the full subscription checkout flow with real
//  on-chain contract interactions
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
 * 2. Smart account check (ERC-7579 — placeholder for ZeroDev)
 * 3. Approve USDC spending for SubscriptionRegistry
 * 4. Mint subscription NFT
 * 5. Success!
 */
export function CheckoutModal({
  planId,
  isOpen,
  onClose,
  onSuccess,
  onError,
  className = '',
}: CheckoutModalProps) {
  const { network, isTestnet } = useMEAP();
  const contracts = getContractAddresses(network.chainId);
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const publicClient = usePublicClient({ chainId: network.chainId });

  const [step, setStep] = useState<CheckoutStep>('connect');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const USDC_ADDRESS = TOKENS[network.chainId as keyof typeof TOKENS]
    ?.USDC as `0x${string}`;
  const registryAddress = contracts.subscriptionRegistry as `0x${string}`;

  // Auto-advance past connect step if already connected
  useEffect(() => {
    if (isConnected && step === 'connect') {
      setStep('account');
    }
  }, [isConnected, step]);

  // Fetch plan details for pricing
  const { data: planData } = useReadContract({
    address: contracts.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: 'getPlan',
    args: [planId],
    chainId: network.chainId,
    query: { enabled: isOpen },
  });

  const plan = planData as any;
  const planPrice = plan?.price as bigint | undefined;
  const planName = plan?.name as string | undefined;
  const planInterval = plan?.billingInterval as number | undefined;

  // Write: USDC approve
  const {
    writeContract: writeApprove,
    data: approveHash,
    isPending: isApproving,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  // Write: Subscription mint
  const {
    writeContract: writeMint,
    data: mintHash,
    isPending: isMinting,
    error: mintError,
    reset: resetMint,
  } = useWriteContract();

  const { isSuccess: mintConfirmed } = useWaitForTransactionReceipt({
    hash: mintHash,
  });

  // Auto-advance after approve confirmation
  useEffect(() => {
    if (approveConfirmed && step === 'approve') {
      setStep('subscribe');
      setLoading(false);
    }
  }, [approveConfirmed, step]);

  // Auto-advance after mint confirmation
  useEffect(() => {
    if (mintConfirmed && step === 'subscribe') {
      setStep('success');
      setLoading(false);
      onSuccess?.(1n); // TODO: Parse tokenId from mint receipt logs
    }
  }, [mintConfirmed, step, onSuccess]);

  // Handle errors from contract writes
  useEffect(() => {
    if (approveError) {
      setError(approveError.message);
      setStep('error');
      setLoading(false);
      onError?.(approveError);
    }
  }, [approveError, onError]);

  useEffect(() => {
    if (mintError) {
      setError(mintError.message);
      setStep('error');
      setLoading(false);
      onError?.(mintError);
    }
  }, [mintError, onError]);

  const handleConnect = useCallback(() => {
    try {
      const injectedConnector = connectors.find(c => c.id === 'injected') || connectors[0];
      if (injectedConnector) {
        connect({ connector: injectedConnector });
      }
    } catch (err: any) {
      setError(err.message);
      setStep('error');
      onError?.(err);
    }
  }, [connect, connectors, onError]);

  const handleDeployAccount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Check if the connected address already has contract code (smart account)
      if (publicClient && address) {
        const code = await publicClient.getCode({ address });
        if (code && code.length > 2) {
          console.log('[CheckoutModal] Smart account detected, skipping deployment');
        } else {
          console.log('[CheckoutModal] EOA detected — ZeroDev integration pending');
          // TODO: Deploy ERC-7579 smart account via ZeroDev SDK
          // For now, proceed with EOA (direct approval + mint)
        }
      }
      setStep('approve');
    } catch (err: any) {
      setError(err.message);
      setStep('error');
      onError?.(err);
    } finally {
      setLoading(false);
    }
  }, [publicClient, address, onError]);

  const handleApprove = useCallback(() => {
    if (!planPrice || !USDC_ADDRESS) return;
    setLoading(true);
    setError(null);

    // Approve 13 months worth (current + 12 renewals)
    const approveAmount = planPrice * 13n;

    writeApprove({
      address: USDC_ADDRESS,
      abi: [{
        type: 'function',
        name: 'approve',
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'nonpayable',
      }] as const,
      functionName: 'approve',
      args: [registryAddress, approveAmount],
      chainId: network.chainId,
    });
  }, [planPrice, USDC_ADDRESS, registryAddress, network.chainId, writeApprove]);

  const handleSubscribe = useCallback(() => {
    if (!address || !planInterval) return;
    setLoading(true);
    setError(null);

    writeMint({
      address: registryAddress,
      abi: SubscriptionRegistryABI,
      functionName: 'mint',
      args: [address, planId, BigInt(planInterval)],
      chainId: network.chainId,
    });
  }, [address, planId, planInterval, registryAddress, network.chainId, writeMint]);

  if (!isOpen) return null;

  const formatPrice = (price: bigint) => `$${(Number(price) / 1e6).toFixed(2)}`;

  const STEP_CONFIG: Record<CheckoutStep, {
    title: string;
    description: string;
    action?: () => void;
    actionLabel?: string;
  }> = {
    connect: {
      title: 'Connect Wallet',
      description: 'Connect your wallet to start the subscription process.',
      action: handleConnect,
      actionLabel: 'Connect Wallet',
    },
    account: {
      title: 'Smart Account Check',
      description: 'Checking your account type for automated billing support.',
      action: handleDeployAccount,
      actionLabel: 'Continue',
    },
    approve: {
      title: 'Approve USDC',
      description: planPrice
        ? `Approve ${formatPrice(planPrice * 13n)} USDC for the subscription billing contract.`
        : 'Approve USDC spending for the billing contract.',
      action: handleApprove,
      actionLabel: isApproving ? 'Confirm in Wallet...' : 'Approve USDC',
    },
    subscribe: {
      title: `Subscribe to ${planName || 'Plan'}`,
      description: planPrice
        ? `Mint your subscription NFT. ${formatPrice(planPrice)} USDC will be charged now.`
        : 'Mint your subscription NFT and activate your plan.',
      action: handleSubscribe,
      actionLabel: isMinting ? 'Confirm in Wallet...' : 'Subscribe Now',
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
  const latestTxHash = mintHash || approveHash;

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
              🔧 Testnet Mode ({network.name})
            </div>
          )}

          {latestTxHash && (
            <div className="meap-tx-hash">
              <a
                href={`https://sepolia.etherscan.io/tx/${latestTxHash}`}
                target="_blank"
                rel="noreferrer"
              >
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
              disabled={loading || isApproving || isMinting}
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
              onClick={() => {
                resetApprove();
                resetMint();
                setError(null);
                setStep(isConnected ? 'account' : 'connect');
              }}
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
