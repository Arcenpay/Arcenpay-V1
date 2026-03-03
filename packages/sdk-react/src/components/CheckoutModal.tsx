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
  | "email"      // optional — between connect and account
  | "account"
  | "autopay"
  | "approve"
  | "subscribe"
  | "success"
  | "error";

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
  deploySmartAccount?: (
    input: SmartAccountDeploymentInput,
  ) => Promise<SmartAccountDeploymentResult>;
  className?: string;
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
  deploySmartAccount,
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
      setError(approveError.message);
      setStep("error");
      setLoading(false);
      onError?.(approveError);
    }
  }, [approveError, onError]);

  useEffect(() => {
    if (mintError) {
      setError(mintError.message);
      setStep("error");
      setLoading(false);
      onError?.(mintError);
    }
  }, [mintError, onError]);

  useEffect(() => {
    if (autopayInstallError) {
      setError(autopayInstallError.message);
      setStep("error");
      setLoading(false);
      onError?.(autopayInstallError);
    }
  }, [autopayInstallError, onError]);

  useEffect(() => {
    if (autopayUninstallError) {
      setError(autopayUninstallError.message);
      setStep("error");
      setLoading(false);
      onError?.(autopayUninstallError);
    }
  }, [autopayUninstallError, onError]);

  const handleConnect = useCallback(() => {
    try {
      const injectedConnector =
        connectors.find((c) => c.id === "injected") || connectors[0];
      if (injectedConnector) {
        connect({ connector: injectedConnector });
      }
    } catch (err: any) {
      setError(err.message);
      setStep("error");
      onError?.(err);
    }
  }, [connect, connectors, onError]);

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
            throw new Error("Wallet client not available. Please reconnect your wallet.");
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
          throw new Error(
            "Smart account deployment failed. Set NEXT_PUBLIC_ZERODEV_PROJECT_ID " +
            "or provide a deploySmartAccount callback to enable automated billing.",
          );
        }
      }
    } catch (err: any) {
      setError(err.message);
      setStep("error");
      onError?.(err);
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
    connectors,
  ]);

  const handleInstallAutopay = useCallback(() => {
    if (
      !paymentAccount ||
      !planProvider ||
      !planPrice ||
      !planInterval ||
      !USDC_ADDRESS
    ) {
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
      description: "Connect your wallet to start the subscription process.",
      action: handleConnect,
      actionLabel: "Connect Wallet",
    },
    email: {
      title: "Add Email (Optional)",
      description: "Get billing updates and renewal reminders. You can skip this.",
      actionLabel: "Continue",
    },
    account: {
      title: "Smart Account Check",
      description: "Checking your account type for automated billing support.",
      action: handleDeployAccount,
      actionLabel: "Continue",
    },
    autopay: {
      title: "Install Autopay Module",
      description: isAutopayInitialized
        ? "Autopay module is already installed for your payment account."
        : "Install autopay module with plan constraints (merchant, token, interval, max amount).",
      action: isAutopayInitialized
        ? () => setStep("approve")
        : handleInstallAutopay,
      actionLabel: isInstallingAutopay
        ? "Confirm in Wallet..."
        : isAutopayInitialized
          ? "Continue"
          : "Install Autopay",
    },
    approve: {
      title: "Approve USDC",
      description: planPrice
        ? `Approve ${formatPrice(planPrice * 13n)} USDC for the subscription billing contract.`
        : "Approve USDC spending for the billing contract.",
      action: handleApprove,
      actionLabel: isApproving ? "Confirm in Wallet..." : "Approve USDC",
    },
    subscribe: {
      title: `Subscribe to ${planName || "Plan"}`,
      description: planPrice
        ? `Mint your subscription NFT. ${formatPrice(planPrice)} USDC will be charged now.`
        : "Mint your subscription NFT and activate your plan.",
      action: handleSubscribe,
      actionLabel: isMinting ? "Confirm in Wallet..." : "Subscribe Now",
    },
    success: {
      title: "🎉 Subscription Active!",
      description:
        "Your subscription NFT has been minted. You now have access to all premium features.",
    },
    error: {
      title: "Something went wrong",
      description: error || "An unexpected error occurred. Please try again.",
    },
  };

  const currentStep = STEP_CONFIG[step];
  const stepNumber =
    ["connect", "account", "autopay", "approve", "subscribe"].indexOf(step) + 1;
  const latestTxHash =
    mintHash || approveHash || autopayInstallHash || smartAccountDeployTxHash;

  return (
    <div className={`meap-checkout-overlay ${className}`} onClick={onClose}>
      <div className="meap-checkout-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="meap-checkout-header">
          <h2>{currentStep.title}</h2>
          <button className="meap-checkout-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Progress */}
        {step !== "success" && step !== "error" && (
          <div className="meap-checkout-progress">
            {["connect", "account", "autopay", "approve", "subscribe"].map(
              (s, i) => (
                <div
                  key={s}
                  className={`meap-checkout-step ${i + 1 <= stepNumber ? "active" : ""} ${i + 1 < stepNumber ? "completed" : ""}`}
                >
                  <div className="meap-step-dot">
                    {i + 1 < stepNumber ? "✓" : i + 1}
                  </div>
                </div>
              ),
            )}
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

          {paymentAccount && (
            <div className="meap-testnet-badge">
              Payment Account: {paymentAccount.slice(0, 6)}...
              {paymentAccount.slice(-4)}
            </div>
          )}

          {(autopayInstalledLocally || isAutopayInitialized) && (
            <div className="meap-testnet-badge">Autopay: Installed</div>
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
              disabled={
                loading ||
                isApproving ||
                isMinting ||
                isInstallingAutopay ||
                isRevokingAutopay
              }
            >
              {loading ? "Processing..." : currentStep.actionLabel}
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
                  {isRevokingAutopay ? "Revoking..." : "Revoke Autopay"}
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
                setStep(isConnected ? "account" : "connect");
              }}
            >
              Try Again
            </button>
          )}
        </div>
        {step === "success" && mintedTokenId > 0n && (
          <div className="meap-checkout-body">
            <p>Subscription token minted: #{mintedTokenId.toString()}</p>
          </div>
        )}
      </div>
    </div>
  );
}
