"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  useAccount,
  useConnect,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { decodeEventLog, encodeAbiParameters, parseAbiParameters } from "viem";
import {
  PlanFactoryABI,
  SubscriptionRegistryABI,
  ERC7579AutopayModuleABI,
  getContractAddresses,
  getBlockExplorerUrl,
  TOKENS,
  createSmartAccount,
} from "@meap/core";
import { useMEAP } from "../providers/MEAPProvider";

// ============================================================
//  CheckoutModal — Wallet connect + Smart Account + Autopay
//  Handles the full subscription checkout flow with real
//  on-chain contract interactions
// ============================================================

type CheckoutStep =
  | "connect"
  | "email" // optional — between connect and account
  | "account"
  | "autopay"
  | "approve"
  | "subscribe"
  | "success"
  | "error";

export const CHECKOUT_ERROR_CODES = {
  WALLET_NOT_CONNECTED: "WALLET_NOT_CONNECTED",
  WALLET_CLIENT_UNAVAILABLE: "WALLET_CLIENT_UNAVAILABLE",
  INVALID_EMAIL: "INVALID_EMAIL",
  PLAN_NOT_AVAILABLE: "PLAN_NOT_AVAILABLE",
  SMART_ACCOUNT_DEPLOYMENT_FAILED: "SMART_ACCOUNT_DEPLOYMENT_FAILED",
  AUTOPAY_INSTALL_FAILED: "AUTOPAY_INSTALL_FAILED",
  AUTOPAY_REVOKE_FAILED: "AUTOPAY_REVOKE_FAILED",
  TOKEN_APPROVAL_FAILED: "TOKEN_APPROVAL_FAILED",
  SUBSCRIPTION_MINT_FAILED: "SUBSCRIPTION_MINT_FAILED",
  CHECKOUT_STATE_INVALID: "CHECKOUT_STATE_INVALID",
  UNKNOWN: "UNKNOWN",
} as const;

export type CheckoutErrorCode =
  (typeof CHECKOUT_ERROR_CODES)[keyof typeof CHECKOUT_ERROR_CODES];

export class CheckoutFlowError extends Error {
  readonly code: CheckoutErrorCode;
  readonly cause?: unknown;

  constructor(code: CheckoutErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "CheckoutFlowError";
    this.code = code;
    this.cause = cause;
  }
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "An unexpected checkout error occurred.";
}

export interface CheckoutResult {
  tokenId: bigint;
  paymentAccount: `0x${string}`;
  autopayInstalled: boolean;
  autopayInstallTxHash?: `0x${string}`;
  subscriptionTxHash?: `0x${string}`;
  smartAccountDeployTxHash?: `0x${string}`;
}

export interface SmartAccountDeploymentResult {
  accountAddress: `0x${string}`;
  txHash?: `0x${string}`;
}

export interface SmartAccountDeploymentInput {
  ownerAddress: `0x${string}`;
  chainId: number;
  zeroDevProjectId?: string;
}

export interface CheckoutModalProps {
  planId: bigint;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (tokenId: bigint) => void;
  onCheckoutComplete?: (result: CheckoutResult) => void;
  onError?: (error: Error) => void;
  onErrorCode?: (code: CheckoutErrorCode, error: Error) => void;
  deploySmartAccount?: (
    input: SmartAccountDeploymentInput,
  ) => Promise<SmartAccountDeploymentResult>;
  /** Endpoint for capturing subscriber email. If omitted, email capture is skipped. */
  subscriberEmailEndpoint?: string;
  className?: string;
}

export function getCheckoutStepOrder(): CheckoutStep[] {
  return [
    "connect",
    "email",
    "account",
    "autopay",
    "approve",
    "subscribe",
    "success",
  ];
}

/**
 * CheckoutModal — Full subscription checkout flow
 *
 * Flow:
 * 1. Connect wallet (if not connected)
 * 2. Smart account check/deploy (ZeroDev via injected deployer callback or API)
 * 3. Approve USDC spending for SubscriptionRegistry
 * 4. Mint subscription NFT
 * 5. Success!
 */
export function CheckoutModal({
  planId,
  isOpen,
  onClose,
  onSuccess,
  onCheckoutComplete,
  onError,
  onErrorCode,
  deploySmartAccount,
  subscriberEmailEndpoint,
  className = "",
}: CheckoutModalProps) {
  const { network, isTestnet } = useMEAP();
  const contracts = getContractAddresses(network.chainId);
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const publicClient = usePublicClient({ chainId: network.chainId });
  const { data: walletClient } = useWalletClient({ chainId: network.chainId });

  const [step, setStep] = useState<CheckoutStep>("connect");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<CheckoutErrorCode | null>(null);
  const [subscriberEmail, setSubscriberEmail] = useState("");
  const [smartAccountAddress, setSmartAccountAddress] = useState<
    `0x${string}` | undefined
  >();
  const [smartAccountDeployTxHash, setSmartAccountDeployTxHash] = useState<
    `0x${string}` | undefined
  >();
  const [autopayInstallTxHash, setAutopayInstallTxHash] = useState<
    `0x${string}` | undefined
  >();
  const [autopayInstalledLocally, setAutopayInstalledLocally] = useState(false);
  const [mintedTokenId, setMintedTokenId] = useState<bigint>(0n);

  const USDC_ADDRESS = TOKENS[network.chainId as keyof typeof TOKENS]
    ?.USDC as `0x${string}`;
  const registryAddress = contracts.subscriptionRegistry as `0x${string}`;
  const autopayAddress = contracts.autopayModule as `0x${string}`;

  // Auto-advance past connect step to email collection step
  useEffect(() => {
    if (isConnected && step === "connect") {
      setStep("email");
    }
  }, [isConnected, step]);

  // Fetch plan details for pricing
  const { data: planData } = useReadContract({
    address: contracts.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: "getPlan",
    args: [planId],
    chainId: network.chainId,
    query: { enabled: isOpen },
  });

  const plan = planData as any;
  const planPrice = plan?.price as bigint | undefined;
  const planName = plan?.name as string | undefined;
  const planInterval = plan?.billingInterval as number | undefined;
  const planProvider = plan?.provider as `0x${string}` | undefined;

  const paymentAccount =
    smartAccountAddress ?? (address as `0x${string}` | undefined);

  const { data: isAutopayInitialized, refetch: refetchAutopayState } =
    useReadContract({
      address: autopayAddress,
      abi: ERC7579AutopayModuleABI,
      functionName: "isInitialized",
      args: [paymentAccount!],
      chainId: network.chainId,
      query: {
        enabled: !!paymentAccount,
      },
    });

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

  const {
    writeContract: writeAutopayInstall,
    data: autopayInstallHash,
    isPending: isInstallingAutopay,
    error: autopayInstallError,
    reset: resetAutopayInstall,
  } = useWriteContract();

  const {
    writeContract: writeAutopayUninstall,
    data: autopayUninstallHash,
    isPending: isRevokingAutopay,
    error: autopayUninstallError,
    reset: resetAutopayUninstall,
  } = useWriteContract();

  const { isSuccess: autopayInstallConfirmed } = useWaitForTransactionReceipt({
    hash: autopayInstallHash,
  });

  const { isSuccess: autopayUninstallConfirmed } = useWaitForTransactionReceipt(
    {
      hash: autopayUninstallHash,
    },
  );

  // Write: Subscription mint
  const {
    writeContract: writeMint,
    data: mintHash,
    isPending: isMinting,
    error: mintError,
    reset: resetMint,
  } = useWriteContract();

  const { isSuccess: mintConfirmed, data: mintReceipt } =
    useWaitForTransactionReceipt({
      hash: mintHash,
    });

  const emitCheckoutError = useCallback(
    (code: CheckoutErrorCode, err: unknown) => {
      const message = normalizeErrorMessage(err);
      const typedError =
        err instanceof CheckoutFlowError
          ? err
          : new CheckoutFlowError(code, message, err);
      setErrorCode(typedError.code);
      setError(typedError.message);
      setStep("error");
      setLoading(false);
      onError?.(typedError);
      onErrorCode?.(typedError.code, typedError);
    },
    [onError, onErrorCode],
  );

  useEffect(() => {
    if (autopayInstallHash) {
      setAutopayInstallTxHash(autopayInstallHash);
    }
  }, [autopayInstallHash]);

  // Auto-advance after autopay install confirmation
  useEffect(() => {
    if (autopayInstallConfirmed && step === "autopay") {
      refetchAutopayState();
      setAutopayInstalledLocally(true);
      setStep("approve");
      setLoading(false);
    }
  }, [autopayInstallConfirmed, step, refetchAutopayState]);

  // Auto-advance after approve confirmation
  useEffect(() => {
    if (approveConfirmed && step === "approve") {
      setStep("subscribe");
      setLoading(false);
    }
  }, [approveConfirmed, step]);

  // Auto-advance after mint confirmation
  useEffect(() => {
    if (mintConfirmed && step === "subscribe") {
      let cancelled = false;

      const resolveTokenAndFinalize = async () => {
        let parsedTokenId = 0n;
        for (const log of mintReceipt?.logs || []) {
          try {
            const decoded = decodeEventLog({
              abi: SubscriptionRegistryABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "SubscriptionMinted") {
              parsedTokenId = decoded.args.tokenId as bigint;
              break;
            }
          } catch {
            // Ignore non-matching logs
          }
        }

        // Fallback for nodes that prune/decode logs inconsistently.
        if (parsedTokenId === 0n && publicClient && paymentAccount) {
          try {
            const onChainTokenId = await publicClient.readContract({
              address: registryAddress,
              abi: SubscriptionRegistryABI,
              functionName: "getWalletSubscription",
              args: [paymentAccount],
            });
            parsedTokenId = onChainTokenId as bigint;
          } catch {
            // Keep best-effort parsedTokenId (possibly 0n).
          }
        }

        if (cancelled) return;

        setMintedTokenId(parsedTokenId);
        setStep("success");
        setLoading(false);
        onSuccess?.(parsedTokenId);
        onCheckoutComplete?.({
          tokenId: parsedTokenId,
          paymentAccount: paymentAccount!,
          autopayInstalled:
            autopayInstalledLocally || isAutopayInitialized === true,
          autopayInstallTxHash,
          subscriptionTxHash: mintHash,
          smartAccountDeployTxHash,
        });
      };

      void resolveTokenAndFinalize();
      return () => {
        cancelled = true;
      };
    }
  }, [
    mintConfirmed,
    step,
    mintReceipt?.logs,
    publicClient,
    registryAddress,
    onSuccess,
    onCheckoutComplete,
    paymentAccount,
    autopayInstalledLocally,
    isAutopayInitialized,
    autopayInstallTxHash,
    mintHash,
    smartAccountDeployTxHash,
  ]);

  useEffect(() => {
    if (autopayUninstallConfirmed) {
      setAutopayInstalledLocally(false);
      refetchAutopayState();
    }
  }, [autopayUninstallConfirmed, refetchAutopayState]);

  // Handle errors from contract writes
  useEffect(() => {
    if (approveError) {
      emitCheckoutError(
        CHECKOUT_ERROR_CODES.TOKEN_APPROVAL_FAILED,
        approveError,
      );
    }
  }, [approveError, emitCheckoutError]);

  useEffect(() => {
    if (mintError) {
      emitCheckoutError(
        CHECKOUT_ERROR_CODES.SUBSCRIPTION_MINT_FAILED,
        mintError,
      );
    }
  }, [mintError, emitCheckoutError]);

  useEffect(() => {
    if (autopayInstallError) {
      emitCheckoutError(
        CHECKOUT_ERROR_CODES.AUTOPAY_INSTALL_FAILED,
        autopayInstallError,
      );
    }
  }, [autopayInstallError, emitCheckoutError]);

  useEffect(() => {
    if (autopayUninstallError) {
      emitCheckoutError(
        CHECKOUT_ERROR_CODES.AUTOPAY_REVOKE_FAILED,
        autopayUninstallError,
      );
    }
  }, [autopayUninstallError, emitCheckoutError]);

  const handleConnect = useCallback(() => {
    try {
      const injectedConnector =
        connectors.find((c) => c.id === "injected") || connectors[0];
      if (injectedConnector) {
        connect({ connector: injectedConnector });
      } else {
        throw new CheckoutFlowError(
          CHECKOUT_ERROR_CODES.WALLET_NOT_CONNECTED,
          "No compatible wallet connector was found.",
        );
      }
    } catch (err) {
      emitCheckoutError(CHECKOUT_ERROR_CODES.WALLET_NOT_CONNECTED, err);
    }
  }, [connect, connectors, emitCheckoutError]);

  const handleDeployAccount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (publicClient && address) {
        // Check if already a smart account (getCode > 2 bytes)
        const code = await publicClient.getCode({ address });
        if (code && code.length > 2) {
          setSmartAccountAddress(address);
          setStep(isAutopayInitialized ? "approve" : "autopay");
          return;
        }

        const deploymentInput: SmartAccountDeploymentInput = {
          ownerAddress: address,
          chainId: network.chainId,
          zeroDevProjectId:
            process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID || undefined,
        };

        let result: SmartAccountDeploymentResult | null = null;

        if (deploySmartAccount) {
          // 1. Caller-supplied deployer (custom integration)
          result = await deploySmartAccount(deploymentInput);
        } else if (deploymentInput.zeroDevProjectId) {
          // 2. Built-in ZeroDev deployer (requires @zerodev/sdk installed)
          if (!walletClient) {
            throw new CheckoutFlowError(
              CHECKOUT_ERROR_CODES.WALLET_CLIENT_UNAVAILABLE,
              "Wallet client not available. Please reconnect your wallet.",
            );
          }
          const zdResult = await createSmartAccount({
            ownerAddress: address,
            chainId: network.chainId,
            zeroDevProjectId: deploymentInput.zeroDevProjectId,
            walletClient: walletClient as any,
          });
          result = {
            accountAddress: zdResult.accountAddress,
            txHash: zdResult.txHash,
          };
        } else if (process.env.NEXT_PUBLIC_ZERODEV_DEPLOY_URL) {
          // 3. Remote deploy API fallback
          const response = await fetch(
            process.env.NEXT_PUBLIC_ZERODEV_DEPLOY_URL,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(deploymentInput),
            },
          );
          if (response.ok) {
            const data = await response.json();
            result = {
              accountAddress: data.smartAccountAddress,
              txHash: data.txHash,
            };
          }
        }

        if (result?.accountAddress) {
          setSmartAccountAddress(result.accountAddress);
          setSmartAccountDeployTxHash(result.txHash);
          setStep("autopay");
        } else {
          throw new CheckoutFlowError(
            CHECKOUT_ERROR_CODES.SMART_ACCOUNT_DEPLOYMENT_FAILED,
            "Smart account deployment failed. Set NEXT_PUBLIC_ZERODEV_PROJECT_ID " +
              "or provide a deploySmartAccount callback to enable automated billing.",
          );
        }
      }
    } catch (err) {
      emitCheckoutError(
        CHECKOUT_ERROR_CODES.SMART_ACCOUNT_DEPLOYMENT_FAILED,
        err,
      );
    } finally {
      setLoading(false);
    }
  }, [
    publicClient,
    address,
    onError,
    deploySmartAccount,
    network.chainId,
    isAutopayInitialized,
    emitCheckoutError,
  ]);

  const handleEmailContinue = useCallback(async () => {
    setLoading(true);
    setError(null);

    const email = subscriberEmail.trim();
    if (email) {
      const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!isEmailValid) {
        const invalidEmailError = new CheckoutFlowError(
          CHECKOUT_ERROR_CODES.INVALID_EMAIL,
          "Enter a valid email address or leave it blank.",
        );
        emitCheckoutError(
          CHECKOUT_ERROR_CODES.INVALID_EMAIL,
          invalidEmailError,
        );
        return;
      }

      if (subscriberEmailEndpoint) {
        try {
          await fetch(subscriberEmailEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              walletAddress: address,
              email,
              planId: planId.toString(),
            }),
          });
        } catch {
          // Email capture is best-effort; checkout should not be blocked if backend is unreachable.
        }
      }
    }

    setStep("account");
    setLoading(false);
  }, [
    subscriberEmail,
    address,
    planId,
    emitCheckoutError,
    subscriberEmailEndpoint,
  ]);

  const handleInstallAutopay = useCallback(() => {
    if (
      !paymentAccount ||
      !planProvider ||
      !planPrice ||
      !planInterval ||
      !USDC_ADDRESS
    ) {
      emitCheckoutError(
        CHECKOUT_ERROR_CODES.CHECKOUT_STATE_INVALID,
        new Error("Plan details are incomplete. Refresh and try again."),
      );
      return;
    }
    setLoading(true);
    setError(null);

    const configData = encodeAbiParameters(
      parseAbiParameters(
        "(address merchant,uint256 maxAmount,address token,uint32 interval,uint64 startTime,uint256 planId)",
      ),
      [
        {
          merchant: planProvider,
          maxAmount: planPrice,
          token: USDC_ADDRESS,
          interval: planInterval,
          startTime: BigInt(Math.floor(Date.now() / 1000) + 60),
          planId,
        },
      ],
    );

    writeAutopayInstall({
      address: autopayAddress,
      abi: ERC7579AutopayModuleABI,
      functionName: "onInstall",
      args: [configData],
      chainId: network.chainId,
    });
  }, [
    paymentAccount,
    planProvider,
    planPrice,
    planInterval,
    USDC_ADDRESS,
    planId,
    writeAutopayInstall,
    autopayAddress,
    network.chainId,
    emitCheckoutError,
  ]);

  const handleRevokeAutopay = useCallback(() => {
    setLoading(true);
    setError(null);
    writeAutopayUninstall({
      address: autopayAddress,
      abi: ERC7579AutopayModuleABI,
      functionName: "onUninstall",
      args: ["0x"],
      chainId: network.chainId,
    });
  }, [writeAutopayUninstall, autopayAddress, network.chainId]);

  const handleApprove = useCallback(() => {
    if (!planPrice || !USDC_ADDRESS) return;
    setLoading(true);
    setError(null);

    // Approve 13 months worth (current + 12 renewals)
    const approveAmount = planPrice * 13n;

    writeApprove({
      address: USDC_ADDRESS,
      abi: [
        {
          type: "function",
          name: "approve",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
          stateMutability: "nonpayable",
        },
      ] as const,
      functionName: "approve",
      args: [registryAddress, approveAmount],
      chainId: network.chainId,
    });
  }, [planPrice, USDC_ADDRESS, registryAddress, network.chainId, writeApprove]);

  const handleSubscribe = useCallback(() => {
    if (!paymentAccount || !planInterval) return;
    setLoading(true);
    setError(null);

    writeMint({
      address: registryAddress,
      abi: SubscriptionRegistryABI,
      functionName: "mint",
      args: [paymentAccount, planId, BigInt(planInterval)],
      chainId: network.chainId,
    });
  }, [
    paymentAccount,
    planId,
    planInterval,
    registryAddress,
    network.chainId,
    writeMint,
  ]);

  if (!isOpen) return null;

  const formatPrice = (price: bigint) => `$${(Number(price) / 1e6).toFixed(2)}`;

  const STEP_CONFIG: Record<
    CheckoutStep,
    {
      title: string;
      description: string;
      action?: () => void;
      actionLabel?: string;
    }
  > = {
    connect: {
      title: "Connect Wallet",
      description:
        "Connect your Web3 wallet to begin. All payments are processed on-chain using stablecoins.",
      action: handleConnect,
      actionLabel: "Connect Wallet",
    },
    email: {
      title: "Billing Email",
      description:
        "Optionally add an email for renewal reminders. Your wallet address is your primary identifier.",
      action: handleEmailContinue,
      actionLabel: "Continue",
    },
    account: {
      title: "Verify Account",
      description:
        "Checking your account type for automated on-chain billing support.",
      action: handleDeployAccount,
      actionLabel: "Continue",
    },
    autopay: {
      title: "Enable Autopay",
      description: isAutopayInitialized
        ? "Autopay is already active on your account."
        : "Authorize the autopay module to handle recurring stablecoin billing on your behalf.",
      action: isAutopayInitialized
        ? () => setStep("approve")
        : handleInstallAutopay,
      actionLabel: isInstallingAutopay
        ? "Confirm in Wallet…"
        : isAutopayInitialized
          ? "Continue"
          : "Enable Autopay",
    },
    approve: {
      title: "Approve USDC",
      description: planPrice
        ? `Authorize ${formatPrice(planPrice * 13n)} USDC for the subscription billing contract. This covers your current cycle plus renewals.`
        : "Authorize USDC spending for the billing contract.",
      action: handleApprove,
      actionLabel: isApproving ? "Confirm in Wallet…" : "Approve USDC",
    },
    subscribe: {
      title: `Subscribe — ${planName || "Plan"}`,
      description: planPrice
        ? `Mint your subscription NFT. ${formatPrice(planPrice)} USDC will be charged from your wallet now.`
        : "Mint your subscription NFT to activate your plan.",
      action: handleSubscribe,
      actionLabel: isMinting ? "Confirm in Wallet…" : "Subscribe Now",
    },
    success: {
      title: "Subscription Active",
      description:
        "Your subscription NFT has been minted on-chain. You now have full access to all plan features.",
    },
    error: {
      title: "Transaction Failed",
      description:
        (errorCode ? `[${errorCode}] ` : "") +
        (error || "An unexpected error occurred. Please try again."),
    },
  };

  const currentStep = STEP_CONFIG[step];
  const progressSteps: CheckoutStep[] = [
    "connect",
    "email",
    "account",
    "autopay",
    "approve",
    "subscribe",
  ];
  const stepNumber = progressSteps.indexOf(step) + 1;
  const latestTxHash =
    mintHash || approveHash || autopayInstallHash || smartAccountDeployTxHash;

  const stepLabels: Partial<Record<CheckoutStep, string>> = {
    connect: "Wallet",
    email: "Email",
    account: "Account",
    autopay: "Autopay",
    approve: "Approve",
    subscribe: "Subscribe",
  };

  return (
    <div className={`meap-checkout-overlay ${className}`} onClick={onClose}>
      <div className="meap-checkout-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="meap-checkout-header">
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h2>{currentStep.title}</h2>
            {planName && step !== "success" && step !== "error" && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontWeight: 500,
                }}
              >
                {planName} · {planPrice ? formatPrice(planPrice) : "—"} USDC
              </span>
            )}
          </div>
          <button
            className="meap-checkout-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Crypto Identity Strip */}
        <div className="meap-checkout-crypto-strip">
          <span style={{ fontSize: 12 }}>⛓</span>
          <span className="meap-checkout-chain-pill">{network.name}</span>
          <span className="meap-checkout-usdc-badge">USDC · Stablecoin</span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              color: "var(--text-muted)",
            }}
          >
            On-chain only
          </span>
        </div>

        {/* Progress */}
        {step !== "success" && step !== "error" && (
          <div className="meap-checkout-progress">
            {progressSteps.map((s, i) => (
              <div
                key={s}
                className={`meap-checkout-step ${i + 1 <= stepNumber ? "active" : ""} ${i + 1 < stepNumber ? "completed" : ""}`}
                title={stepLabels[s]}
              >
                <div className="meap-step-dot">
                  {i + 1 < stepNumber ? "✓" : i + 1}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="meap-checkout-body">
          <p>{currentStep.description}</p>

          {step === "email" && (
            <div className="meap-email-input-group">
              <label htmlFor="meap-subscriber-email">Email (optional)</label>
              <input
                id="meap-subscriber-email"
                type="email"
                placeholder="you@company.com"
                value={subscriberEmail}
                onChange={(event) => setSubscriberEmail(event.target.value)}
                className="meap-email-input"
              />
            </div>
          )}

          {step === "success" && mintedTokenId > 0n && (
            <div
              style={{
                background: "var(--success-dim)",
                border: "1px solid rgba(34,197,94,0.2)",
                borderRadius: 8,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--success)",
                fontWeight: 600,
              }}
            >
              <span>◈</span>
              <span>NFT Token #{mintedTokenId.toString()}</span>
            </div>
          )}

          {isTestnet && (
            <div className="meap-testnet-badge">
              ◎ Testnet Mode — {network.name}
            </div>
          )}

          {paymentAccount && step !== "connect" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              <span style={{ color: "var(--success)", fontSize: 12 }}>●</span>
              {paymentAccount.slice(0, 8)}…{paymentAccount.slice(-6)}
            </div>
          )}

          {(autopayInstalledLocally || isAutopayInitialized) &&
            step !== "connect" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: "var(--success)",
                }}
              >
                <span>✓</span> Autopay active
              </div>
            )}

          {latestTxHash && (
            <div className="meap-tx-hash">
              <a
                href={getBlockExplorerUrl(network.chainId, latestTxHash)}
                target="_blank"
                rel="noreferrer"
              >
                View on Explorer →
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
              disabled={
                loading ||
                isApproving ||
                isMinting ||
                isInstallingAutopay ||
                isRevokingAutopay
              }
            >
              {loading ? (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 13,
                      height: 13,
                      border: "2px solid rgba(0,0,0,0.2)",
                      borderTopColor: "#000",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                  Processing…
                </span>
              ) : (
                currentStep.actionLabel
              )}
            </button>
          )}

          {step === "success" && (
            <>
              {(autopayInstalledLocally || isAutopayInitialized) && (
                <button
                  className="meap-checkout-btn secondary"
                  onClick={handleRevokeAutopay}
                  disabled={isRevokingAutopay}
                >
                  {isRevokingAutopay ? "Revoking…" : "Revoke Autopay"}
                </button>
              )}
              <button className="meap-checkout-btn primary" onClick={onClose}>
                Done
              </button>
            </>
          )}

          {step === "error" && (
            <button
              className="meap-checkout-btn secondary"
              onClick={() => {
                resetApprove();
                resetMint();
                resetAutopayInstall();
                resetAutopayUninstall();
                setError(null);
                setErrorCode(null);
                setStep(isConnected ? "account" : "connect");
              }}
            >
              Try Again
            </button>
          )}
        </div>

        {/* Powered by Arcenpay Footer */}
        <div className="meap-checkout-footer">
          <a
            href="https://arcenpay.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="arcenpay-badge"
          >
            <span className="arcenpay-badge-dot" />
            Powered by Arcenpay
          </a>
        </div>
      </div>
    </div>
  );
}
