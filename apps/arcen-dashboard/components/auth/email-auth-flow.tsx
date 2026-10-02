"use client";
import { apiFetch } from "@/lib/api-client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  Wallet,
  Shield,
  AlertTriangle,
  ExternalLink,
  ArrowRight,
  KeyRound,
  LogOut,
} from "lucide-react";
import { NetworkIcon } from "@web3icons/react/dynamic";
import { AuthMarketingPanel } from "./auth-marketing-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { buildSIWEMessage } from "@/lib/auth";
import { wagmiConfig } from "@/lib/wagmi";
import {
  DEFAULT_WALLET_CHAIN_LABEL,
  SUPPORTED_WALLET_CHAIN_LABEL,
  useDashboardWallet,
} from "@/hooks/use-dashboard-wallet";
import { useStellarWallet } from "@/hooks/use-stellar-wallet";
import { useSolanaWallet } from "@/hooks/use-solana-wallet";
import { SOLANA_DEVNET_CHAIN_ID } from "@/lib/default-chain";
import {
  getOnboardingChainFamily,
  setOnboardingChainFamily,
} from "@/lib/onboarding-chain-family";
import { isPlatformAdminEmail } from "@/lib/admin";
import { getChainFamily, type ChainFamily } from "@arcenpay/internal-core";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

type EmailAuthFlowProps = {
  inviteToken?: string | null;
  initialStep?: Step;
  initialKey?: string | null;
};

type Step = "chain" | "wallet" | "email" | "code" | "sign" | "activate";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function stellarShortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

function formatTimer(targetIso: string | null): string {
  if (!targetIso) return "00:30";
  const diffMs = Math.max(0, new Date(targetIso).getTime() - Date.now());
  const seconds = Math.ceil(diffMs / 1000);
  const mins = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function EmailAuthFlow({
  inviteToken,
  initialStep,
  initialKey,
}: EmailAuthFlowProps) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const {
    isOnRequiredNetwork,
    isSwitchingChain,
    openConnectModal,
    reconnectWallet,
    switchToRequiredNetwork,
  } = useDashboardWallet();
  const stellarWallet = useStellarWallet();
  const solanaWallet = useSolanaWallet(SOLANA_DEVNET_CHAIN_ID);
  const [step, setStep] = useState<Step>(initialStep ?? "chain");
  const [chainFamily, setChainFamily] = useState<ChainFamily | null>(() =>
    getOnboardingChainFamily(),
  );
  const isStellar = chainFamily === "stellar";
  const isSolana = chainFamily === "solana";

  const selectChainFamily = (family: ChainFamily) => {
    setOnboardingChainFamily(family);
    setChainFamily(family);
    setStep("wallet");
  };

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [timerLabel, setTimerLabel] = useState("00:30");
  const [isLinkingWallet, setIsLinkingWallet] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Set when the entered email already has an account with a different wallet —
  // the user is adding another chain family's wallet to an existing account.
  const [existingAccountWallet, setExistingAccountWallet] = useState<string | null>(null);

  /* Activation key states */
  const [activationKey, setActivationKey] = useState(initialKey?.trim() || "");
  const [verifyingKey, setVerifyingKey] = useState(false);
  const [redeemingKey, setRedeemingKey] = useState(false);
  const [isPlatformAdminUser, setIsPlatformAdminUser] = useState(false);
  const [keyVerification, setKeyVerification] = useState<{
    valid: boolean;
    reason?: string;
    key?: {
      id: string;
      key: string;
      name: string;
      tier: "FREE" | "PLUS" | "PRO";
      allowPlatformBilling: boolean;
      maxUses: number;
      usedCount: number;
    };
  } | null>(null);

  useEffect(() => {
    if (step === "activate") {
      apiFetch("/api/auth/session")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.user?.email && !email) {
            setEmail(data.user.email);
          }
          if (
            data?.user?.isPlatformAdmin === true ||
            isPlatformAdminEmail(data?.user?.email)
          ) {
            setIsPlatformAdminUser(true);
          }
        })
        .catch(() => {});
    }
  }, [step, email]);

  const handleActivationKeyChange = (val: string) => {
    let clean = val.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!clean.startsWith("ARCN") && clean.length > 0) {
      if ("ARCN".startsWith(clean)) {
        // typing prefix
      } else {
        clean = "ARCN" + clean;
      }
    }

    const parts: string[] = [];
    if (clean.length > 0) parts.push(clean.slice(0, 4));
    if (clean.length > 4) parts.push(clean.slice(4, 8));
    if (clean.length > 8) parts.push(clean.slice(8, 12));
    if (clean.length > 12) parts.push(clean.slice(12, 16));

    const formatted = parts.join("-");
    setActivationKey(formatted);
    setKeyVerification(null);
  };

  useEffect(() => {
    if (activationKey.length === 19) {
      void verifyActivationKey(activationKey);
    }
  }, [activationKey]);

  const verifyActivationKey = async (keyToVerify: string) => {
    setVerifyingKey(true);
    try {
      const res = await apiFetch("/api/activation/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyToVerify }),
      });
      const data = await res.json();
      if (data.ok && data.valid && data.key) {
        setKeyVerification(data);
      } else {
        setKeyVerification({ valid: false, reason: data.reason || data.error });
      }
    } catch {
      setKeyVerification({
        valid: false,
        reason: "Unable to verify key with server",
      });
    } finally {
      setVerifyingKey(false);
    }
  };

  const handleRedeemKey = async () => {
    if (!activationKey.trim()) {
      toast.error("Please enter a valid activation key");
      return;
    }

    setRedeemingKey(true);
    try {
      const res = await apiFetch("/api/activation/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: activationKey.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success("Workspace activated");
        router.push("/onboarding/provider-profile");
      } else {
        toast.error(data.error || "Failed to redeem activation key");
        if (data.reason) {
          setKeyVerification({ valid: false, reason: data.reason });
        }
      }
    } catch {
      toast.error("Network error during activation");
    } finally {
      setRedeemingKey(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {}
    window.location.href = "/login";
  };

  useEffect(() => {
    if (!retryAt) return;
    setTimerLabel(formatTimer(retryAt));
    const interval = window.setInterval(() => {
      setTimerLabel(formatTimer(retryAt));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [retryAt]);

  const canResend = useMemo(() => {
    if (!retryAt) return true;
    return new Date(retryAt).getTime() <= Date.now();
  }, [retryAt, timerLabel]);

  const navigatePostAuth = async () => {
    try {
      const sessionRes = await apiFetch("/api/auth/session");
      if (sessionRes.ok) {
        const data = await sessionRes.json();
        const isAdmin =
          data?.user?.isPlatformAdmin === true ||
          isPlatformAdminEmail(data?.user?.email);
        const isActivated =
          isAdmin || data?.currentTeam?.isPlatformActivated === true;
        const keyStatus = data?.currentTeam?.activationKeyStatus;
        const isExpiredOrRevoked =
          keyStatus === "EXPIRED" || keyStatus === "REVOKED";
        if (isActivated || isExpiredOrRevoked) {
          const environments = Array.isArray(data?.environments) ? data.environments : [];
          const family = chainFamily ?? getOnboardingChainFamily();

          if (environments.length > 0 && family) {
            const matchingEnv = environments.find(
              (e: any) => getChainFamily(e.chainId) === family,
            );
            if (matchingEnv) {
              await apiFetch("/api/environments/select", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ environmentId: matchingEnv.id }),
              }).catch(() => {});
              window.location.href = "/";
              return;
            }

            // Auto-create environment for this chain
            try {
              const chainId =
                family === "solana"
                  ? 9100001
                  : family === "stellar"
                    ? 9000001
                    : 84532;
              const name =
                family === "solana"
                  ? "Solana Devnet"
                  : family === "stellar"
                    ? "Stellar Testnet"
                    : "Development";
              const createRes = await apiFetch("/api/environments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, mode: "DEVELOPMENT", chainId }),
              });
              if (createRes.ok) {
                const envPayload = await createRes.json().catch(() => ({}));
                const newEnvId = envPayload?.environment?.id;
                if (newEnvId) {
                  await apiFetch("/api/environments/select", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ environmentId: newEnvId }),
                  }).catch(() => {});
                }
                window.location.href = "/";
                return;
              }
            } catch {}

            window.location.href = "/onboarding/environment";
            return;
          }

          const destination = environments.length > 0 ? "/" : "/onboarding/provider-profile";
          window.location.href = destination;
          return;
        }
      }
    } catch {
      // Fall through to the activation step below.
    }
    setStep("activate");
  };

  const linkWalletForSession = async (): Promise<boolean> => {
    // Stellar path
    if (chainFamily === "stellar") {
      if (!stellarWallet.address || !stellarWallet.isConnected) {
        setError("Reconnect your Stellar wallet to finish signing.");
        setStep("wallet");
        return false;
      }
      setIsLinkingWallet(true);
      setError(null);
      try {
        const nonceResponse = await apiFetch("/api/auth/nonce");
        if (!nonceResponse.ok)
          throw new Error("Could not start wallet verification.");
        const noncePayload = await nonceResponse.json();
        const nonce = noncePayload?.nonce as string | undefined;
        const issuedAt = noncePayload?.issuedAt as string | undefined;
        if (!nonce || !issuedAt)
          throw new Error("Wallet verification challenge is invalid.");

        const message = `ArcenPay Stellar Sign-In\n\nAddress: ${stellarWallet.address}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nDomain: ${window.location.host}`;
        const { signedMessage } = await stellarWallet.signMessage(message);

        const linkResponse = await apiFetch("/api/auth/link-wallet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            signature: signedMessage,
            address: stellarWallet.address,
            chainId: 9000001,
            nonce,
          }),
        });
        const linkPayload = await linkResponse.json().catch(() => ({}));
        if (!linkResponse.ok) {
          if (linkResponse.status === 409 && linkPayload.maskedOwnerEmail)
            throw new Error(
              `This wallet is already linked (${linkPayload.maskedOwnerEmail}).`,
            );
          throw new Error(linkPayload.error || "Could not link this wallet.");
        }
        setOnboardingChainFamily("stellar");
        await navigatePostAuth();
        return true;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Could not link wallet.";
        setError(
          msg.toLowerCase().includes("rejected") ? "Signature cancelled." : msg,
        );
        return false;
      } finally {
        setIsLinkingWallet(false);
      }
    }

    // Solana path
    if (chainFamily === "solana") {
      if (!solanaWallet.address || !solanaWallet.isConnected) {
        setError("Reconnect your Solana wallet to finish signing.");
        setStep("wallet");
        return false;
      }
      setIsLinkingWallet(true);
      setError(null);
      try {
        const nonceResponse = await apiFetch("/api/auth/nonce");
        if (!nonceResponse.ok)
          throw new Error("Could not start wallet verification.");
        const noncePayload = await nonceResponse.json();
        const nonce = noncePayload?.nonce as string | undefined;
        const issuedAt = noncePayload?.issuedAt as string | undefined;
        if (!nonce || !issuedAt)
          throw new Error("Wallet verification challenge is invalid.");

        // Must match the backend's expected message exactly (link-wallet.ts).
        const message = `ArcenPay Solana Sign-In\n\nAddress: ${solanaWallet.address}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nDomain: ${window.location.host}`;
        const { signedMessage } = await solanaWallet.signMessage(message);

        const linkResponse = await apiFetch("/api/auth/link-wallet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            signature: signedMessage,
            address: solanaWallet.address,
            chainId: SOLANA_DEVNET_CHAIN_ID,
            nonce,
          }),
        });
        const linkPayload = await linkResponse.json().catch(() => ({}));
        if (!linkResponse.ok) {
          if (linkResponse.status === 409 && linkPayload.maskedOwnerEmail)
            throw new Error(
              `This wallet is already linked (${linkPayload.maskedOwnerEmail}).`,
            );
          throw new Error(linkPayload.error || "Could not link this wallet.");
        }
        setOnboardingChainFamily("solana");
        await navigatePostAuth();
        return true;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Could not link wallet.";
        setError(
          msg.toLowerCase().includes("rejected") ? "Signature cancelled." : msg,
        );
        return false;
      } finally {
        setIsLinkingWallet(false);
      }
    }

    // EVM path (existing)
    if (!isConnected || !address) {
      setError("Reconnect your wallet to finish signing.");
      setStep("wallet");
      return false;
    }

    if (!isOnRequiredNetwork) {
      setError(
        `Switch to a supported network (${SUPPORTED_WALLET_CHAIN_LABEL}) before signing.`,
      );
      setStep("wallet");
      return false;
    }

    setIsLinkingWallet(true);
    setError(null);
    try {
      const nonceResponse = await apiFetch("/api/auth/nonce");
      if (!nonceResponse.ok) {
        throw new Error("Could not start wallet verification.");
      }

      const noncePayload = await nonceResponse.json();
      const nonce = noncePayload?.nonce as string | undefined;
      const issuedAt = noncePayload?.issuedAt as string | undefined;
      if (!nonce || !issuedAt) {
        throw new Error("Wallet verification challenge is invalid.");
      }

      const message = buildSIWEMessage({
        address,
        chainId,
        nonce,
        domain: window.location.host,
        uri: window.location.origin,
        issuedAt,
      });

      // Pre-check and restore provider session if using WalletConnect
      const currentConn = wagmiConfig.state.connections.get(
        wagmiConfig.state.current ?? "",
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider: any = await currentConn?.connector?.getProvider?.();
      if (provider) {
        if (!provider.session && provider.client?.session?.getAll) {
          try {
            const sessions = provider.client.session.getAll();
            if (Array.isArray(sessions) && sessions.length > 0) {
              provider.session = sessions[sessions.length - 1];
              provider.createProviders?.();
            }
          } catch {}
        }
      }

      let signature: string;
      try {
        signature = await signMessageAsync({ message });
      } catch (signErr: any) {
        const errMsg = signErr?.message || "";
        const isConnectorOrSessionError =
          errMsg.includes("does not match the connection's chain") ||
          errMsg.includes("ConnectorChainMismatchError") ||
          errMsg.includes("ConnectorUnavailableReconnectingError") ||
          errMsg.includes("ConnectorNotConnectedError") ||
          errMsg.includes("before request()") ||
          errMsg.includes("before enable()") ||
          errMsg.includes("connect()");

        if (isConnectorOrSessionError) {
          console.warn(
            "[EmailAuthFlow] signMessageAsync failed with connector/session error, attempting direct provider personal_sign:",
            errMsg,
          );
          if (provider && typeof provider.request === "function") {
            // Ensure session is recovered before direct request
            if (!provider.session && provider.client?.session?.getAll) {
              try {
                const sessions = provider.client.session.getAll();
                if (Array.isArray(sessions) && sessions.length > 0) {
                  provider.session = sessions[sessions.length - 1];
                  provider.createProviders?.();
                }
              } catch {}
            }
            try {
              signature = await provider.request({
                method: "personal_sign",
                params: [message, address],
              });
            } catch (fallbackErr: any) {
              if (
                fallbackErr?.message?.includes("invalid") ||
                fallbackErr?.code === -32602
              ) {
                signature = await provider.request({
                  method: "personal_sign",
                  params: [address, message],
                });
              } else {
                throw fallbackErr;
              }
            }
          } else {
            throw signErr;
          }
        } else {
          throw signErr;
        }
      }
      const linkResponse = await apiFetch("/api/auth/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          signature,
          address,
          chainId,
          nonce,
        }),
      });

      const linkPayload = await linkResponse.json().catch(() => ({}));
      if (!linkResponse.ok) {
        if (linkResponse.status === 409 && linkPayload.maskedOwnerEmail) {
          throw new Error(
            `This wallet is already linked to another account (${linkPayload.maskedOwnerEmail}). Please sign in with that email instead.`,
          );
        }
        throw new Error(linkPayload.error || "Could not link this wallet.");
      }
      setOnboardingChainFamily("evm");
      await navigatePostAuth();
      return true;
    } catch (linkError) {
      const message =
        linkError instanceof Error
          ? linkError.message
          : "Could not link this wallet.";
      if (message.toLowerCase().includes("rejected") || message.toLowerCase().includes("denied")) {
        setError("Signature cancelled. Click Sign wallet to finish login.");
      } else if (
        message.includes("before request()") ||
        message.includes("before enable()") ||
        message.includes("Session not initialized")
      ) {
        setError("Wallet connection session expired. Please reconnect your wallet to finish signing.");
      } else {
        setError(`Wallet signing failed: ${message}`);
      }
      return false;
    } finally {
      setIsLinkingWallet(false);
    }
  };

  const submitEmail = () => {
    const walletAddr = isStellar
      ? stellarWallet.address
      : isSolana
        ? solanaWallet.address
        : address;
    const walletConnected = isStellar
      ? stellarWallet.isConnected && stellarWallet.address
      : isSolana
        ? solanaWallet.isConnected && solanaWallet.address
        : isConnected && address;

    if (!walletConnected) {
      setError("Connect your wallet first.");
      setStep("wallet");
      return;
    }

    startTransition(async () => {
      setError(null);
      const response = await apiFetch("/api/auth/email/start", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          walletAddress: walletAddr,
          ...(inviteToken ? { inviteToken } : {}),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      console.info("[DEBUG-auth-20260907] email start completed", {
        status: response.status,
        code: payload.code ?? null,
      });
      if (!response.ok) {
        if (response.status === 409 && payload.ownerWallet) {
          setError(
            `This email is already linked to a different wallet. Please sign in with the wallet registered for this email.`,
          );
        } else if (response.status === 409 && payload.maskedOwnerEmail) {
          setError(
            `This wallet is already linked to another account (${payload.maskedOwnerEmail}). Please sign in with that email instead.`,
          );
        } else {
          setError(payload.error || "Could not send a verification code.");
        }
        if (payload.retryAt) setRetryAt(payload.retryAt);
        return;
      }

      setDebugCode(payload.debugCode ?? null);
      setRetryAt(payload.retryAt ?? null);
      setExpiresAt(payload.expiresAt ?? null);
      setExistingAccountWallet(
        typeof payload.existingAccountWallet === "string"
          ? payload.existingAccountWallet
          : null,
      );
      setCode("");
      setStep("code");
    });
  };

  const submitCode = () => {
    startTransition(async () => {
      setError(null);
      const response = await apiFetch("/api/auth/email/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          code,
          walletAddress: isStellar
            ? stellarWallet.address
            : isSolana
              ? solanaWallet.address
              : address || undefined,
          ...(inviteToken ? { inviteToken } : {}),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      console.info("[DEBUG-auth-20260907] email verify completed", {
        status: response.status,
        code: payload.code ?? null,
      });
      if (!response.ok) {
        if (response.status === 409 && payload.ownerWallet) {
          setError(
            `This email is already linked to a different wallet. Please sign in with the wallet registered for this email.`,
          );
        } else if (response.status === 409 && payload.maskedOwnerEmail) {
          setError(
            `This wallet is already linked to another account (${payload.maskedOwnerEmail}). Please sign in with that email instead.`,
          );
        } else {
          setError(payload.error || "Could not verify this code.");
        }
        return;
      }

      setStep("sign");
      console.info("[DEBUG-auth-20260907] email verified; linking wallet");
      await linkWalletForSession();
    });
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row font-sans">
      {/* Left Side — Form */}
      <div className="flex-1 flex flex-col bg-background min-w-0">
        {/* Logo */}
        <div className="px-4 sm:px-8 py-4 sm:py-6 lg:px-12 lg:py-8">
          <img
            src="/arcenpay-logo.png"
            alt="ArcenPay"
            className="h-7 sm:h-8 w-auto object-contain dark:brightness-0 dark:invert"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>

        {/* Form Content */}
        <div className="flex-1 flex items-start sm:items-center justify-center px-4 sm:px-8 pb-6 sm:pb-10 lg:px-12 pt-2 sm:pt-0">
          <div className="w-full max-w-sm">
            {/* Header */}
            <div className="mb-6 sm:mb-8">
              <h1 className="text-2xl sm:text-[28px] font-semibold text-foreground tracking-tight">
                {step === "chain" && "Choose your blockchain"}
                {step === "wallet" && isStellar && "Connect Stellar wallet"}
                {step === "wallet" && isSolana && "Connect Solana wallet"}
                {step === "wallet" &&
                  !isStellar &&
                  !isSolana &&
                  "Connect your wallet"}
                {step === "email" && "Continue with email"}
                {step === "code" && "Enter verification code"}
                {step === "sign" && "Sign to finish"}
                {step === "activate" && "Activate workspace"}
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground mt-2 sm:mt-3 leading-relaxed">
                {step === "chain" &&
                  "Select your blockchain ecosystem first. You'll connect the appropriate wallet next."}
                {step === "wallet" &&
                  !isStellar &&
                  !isSolana &&
                  "Connect an EVM wallet (Base, Arc, BOT Chain, Ethereum). After email verification, we'll request one signature and complete setup."}
                {step === "wallet" &&
                  isStellar &&
                  "Connect a Stellar wallet (Freighter, xBull, LOBSTR). After email verification, we'll request one signature and complete setup."}
                {step === "wallet" &&
                  isSolana &&
                  "Connect a Solana wallet (Phantom, Solflare). After email verification, we'll request one signature and complete setup."}
                {step === "email" &&
                  "Once your wallet is connected, we'll send a 6-digit code to your email."}
                {step === "code" &&
                  `We sent a code to ${email}. Enter it below to continue.`}
                {step === "sign" &&
                  "One signature remains to link this wallet to your account."}
                {step === "activate" &&
                  "Enter your platform activation key to verify your license and continue setup."}
              </p>
            </div>

            {inviteToken ? (
              <div className="mb-6 text-sm text-muted-foreground">
                Workspace invite detected. Use the invited email after
                connecting your wallet.
              </div>
            ) : null}

            {error ? (
              <div className="mb-6 text-sm text-red-600">{error}</div>
            ) : null}

            {step === "chain" ? (
              <div className="space-y-4">
                {/* EVM Card */}
                <button
                  onClick={() => selectChainFamily("evm")}
                  className="w-full flex items-center gap-4 p-5 rounded-xl border-2 border-border hover:border-brand/40 hover:bg-accent/5 transition-all text-left group"
                >
                  <div
                    className="relative flex shrink-0"
                    style={{ width: 70, height: 44 }}
                  >
                    <div className="w-7 h-7 rounded-full bg-white dark:bg-white p-[2px] absolute left-[42px] top-0 z-0 ring-2 ring-background overflow-hidden flex items-center justify-center">
                      <Image
                        src="/botchain.jpg"
                        alt="BOT Chain"
                        width={28}
                        height={28}
                        className="rounded-full object-cover"
                        unoptimized
                      />
                    </div>
                    <NetworkIcon
                      name="ethereum"
                      variant="branded"
                      size={28}
                      className="rounded-full bg-white dark:bg-white p-[2px] absolute left-[28px] top-0 z-10 ring-2 ring-background"
                    />
                    <NetworkIcon
                      name="Arc"
                      variant="branded"
                      size={28}
                      className="rounded-full bg-white dark:bg-white p-[2px] absolute left-[14px] top-0 z-20 ring-2 ring-background"
                    />
                    <NetworkIcon
                      name="base"
                      variant="branded"
                      size={28}
                      className="rounded-full bg-white dark:bg-white p-[2px] absolute left-0 top-0 z-30 ring-2 ring-background"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground group-hover:text-brand transition-colors">
                      EVM Networks
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Base, Arc, BOT, Ethereum — MetaMask, Rainbow,
                      WalletConnect
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-brand transition-colors shrink-0" />
                </button>

                {/* Stellar Card */}
                <button
                  onClick={() => selectChainFamily("stellar")}
                  className="w-full flex items-center gap-4 p-5 rounded-xl border-2 border-border hover:border-brand/40 hover:bg-accent/5 transition-all text-left group"
                >
                  <div className="w-[44px] h-[44px] rounded-full bg-white dark:bg-white flex items-center justify-center shrink-0 ring-2 ring-background">
                    <NetworkIcon name="stellar" variant="branded" size={30} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground group-hover:text-brand transition-colors">
                      Stellar Networks
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Stellar Testnet &amp; Mainnet — Freighter, xBull, LOBSTR
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-brand transition-colors shrink-0" />
                </button>

                {/* Solana Card */}
                <button
                  onClick={() => selectChainFamily("solana")}
                  className="w-full flex items-center gap-4 p-5 rounded-xl border-2 border-border hover:border-brand/40 hover:bg-accent/5 transition-all text-left group"
                >
                  <div className="w-[44px] h-[44px] rounded-full bg-white dark:bg-white flex items-center justify-center shrink-0 ring-2 ring-background">
                    <NetworkIcon name="solana" variant="branded" size={30} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground group-hover:text-brand transition-colors">
                      Solana Networks
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Solana Devnet — Phantom, Solflare
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-brand transition-colors shrink-0" />
                </button>
              </div>
            ) : step === "wallet" && chainFamily === "solana" ? (
              <div className="space-y-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <NetworkIcon
                    name="solana"
                    variant="branded"
                    size={20}
                    className="rounded-full"
                  />
                  <span>Select a Solana wallet to connect</span>
                </div>

                {solanaWallet.error && (
                  <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                    {solanaWallet.error}
                  </div>
                )}

                {solanaWallet.address ? (
                  <>
                    <div className="p-4 rounded-xl bg-brand/5 border border-brand/20">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-brand shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Connected
                          </p>
                          <code className="text-xs font-mono text-muted-foreground">
                            {stellarShortAddress(solanaWallet.address)}
                          </code>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                      onClick={() => {
                        setError(null);
                        setStep("email");
                      }}
                    >
                      Continue
                    </Button>
                    <div className="flex items-center gap-4 text-xs">
                      <button
                        type="button"
                        className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={() => void solanaWallet.disconnect()}
                      >
                        Disconnect
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={async () => {
                          await solanaWallet.disconnect();
                          await solanaWallet.connect();
                        }}
                      >
                        Use a different wallet
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground rounded-lg flex items-center justify-center gap-2 font-medium disabled:opacity-60"
                    onClick={() => void solanaWallet.connect()}
                    disabled={solanaWallet.isLoading}
                  >
                    {solanaWallet.isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <NetworkIcon
                          name="solana"
                          variant="branded"
                          size={18}
                          className="rounded-full"
                        />
                        Connect Solana wallet
                      </>
                    )}
                  </button>
                )}

                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                    onClick={() => {
                      setChainFamily(null);
                      setStep("chain");
                    }}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : step === "wallet" && chainFamily === "stellar" ? (
              <div className="space-y-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <NetworkIcon
                    name="stellar"
                    variant="branded"
                    size={20}
                    className="rounded-full"
                  />
                  <span>Select a Stellar wallet to connect</span>
                </div>

                {stellarWallet.error && (
                  <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                    {stellarWallet.error}
                  </div>
                )}

                {stellarWallet.address ? (
                  <>
                    <div className="p-4 rounded-xl bg-brand/5 border border-brand/20">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-brand shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Connected
                          </p>
                          <code className="text-xs font-mono text-muted-foreground">
                            {stellarShortAddress(stellarWallet.address)}
                          </code>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                      onClick={() => {
                        setError(null);
                        setStep("email");
                      }}
                    >
                      Continue
                    </Button>
                    <div className="flex items-center gap-4 text-xs">
                      <button
                        type="button"
                        className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={() => void stellarWallet.disconnect()}
                      >
                        Disconnect
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={async () => {
                          await stellarWallet.disconnect();
                          await stellarWallet.connect();
                        }}
                      >
                        Use a different wallet
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground rounded-lg flex items-center justify-center gap-2 font-medium disabled:opacity-60"
                    onClick={() => void stellarWallet.connect()}
                    disabled={stellarWallet.isLoading || !stellarWallet.ready}
                  >
                    {!stellarWallet.ready || stellarWallet.isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Initializing wallet kit...
                      </>
                    ) : (
                      <>
                        <NetworkIcon
                          name="stellar"
                          variant="branded"
                          size={18}
                          className="rounded-full"
                        />
                        Connect Stellar wallet
                      </>
                    )}
                  </button>
                )}

                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                    onClick={() => {
                      setChainFamily(null);
                      setStep("chain");
                    }}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : step === "wallet" ? (
              <div className="space-y-5">
                {/* Wallet Status */}
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div className="flex items-center gap-3">
                    <Wallet className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Wallet status
                      </p>
                      {isConnected && address ? (
                        <p className="text-sm font-mono text-foreground">
                          {shortAddress(address)}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Not connected
                        </p>
                      )}
                    </div>
                  </div>
                  {isConnected && address && (
                    <CheckCircle2 className="h-5 w-5 text-brand" />
                  )}
                </div>

                <Button
                  type="button"
                  variant={isConnected ? "outline" : "default"}
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                  onClick={() =>
                    void (isConnected ? reconnectWallet() : openConnectModal())
                  }
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  {isConnected ? "Change wallet" : "Connect wallet"}
                </Button>

                {isConnected && !isOnRequiredNetwork ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full"
                    onClick={() => void switchToRequiredNetwork()}
                    disabled={isSwitchingChain}
                  >
                    {isSwitchingChain ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Switching network
                      </>
                    ) : (
                      `Switch to ${DEFAULT_WALLET_CHAIN_LABEL}`
                    )}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                  disabled={!isConnected || !address || !isOnRequiredNetwork}
                  onClick={() => {
                    setError(null);
                    setStep("email");
                  }}
                >
                  Continue
                </Button>

                <button
                  type="button"
                  className="w-full text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 mt-3"
                  onClick={() => {
                    setChainFamily(null);
                    setStep("chain");
                  }}
                >
                  Back to chain selection
                </button>
              </div>
            ) : null}

            {step === "email" ? (
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {isStellar ? (
                    <>
                      <NetworkIcon
                        name="stellar"
                        variant="branded"
                        size={14}
                        className="rounded-full"
                      />
                      <span className="font-mono">
                        {stellarWallet.address
                          ? stellarShortAddress(stellarWallet.address)
                          : "Not connected"}
                      </span>
                    </>
                  ) : isSolana ? (
                    <>
                      <NetworkIcon
                        name="solana"
                        variant="branded"
                        size={14}
                        className="rounded-full"
                      />
                      <span className="font-mono">
                        {solanaWallet.address
                          ? stellarShortAddress(solanaWallet.address)
                          : "Not connected"}
                      </span>
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      <span className="font-mono">
                        {address ? shortAddress(address) : "Not connected"}
                      </span>
                    </>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Work email
                  </label>
                  <Input
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-12 bg-background"
                  />
                </div>

                <Button
                  type="button"
                  onClick={submitEmail}
                  disabled={isPending || isLinkingWallet || !email.trim()}
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending code
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Send verification code
                    </>
                  )}
                </Button>

                {debugCode ? (
                  <div className="text-sm text-muted-foreground">
                    Dev code:{" "}
                    <span className="font-mono font-semibold">{debugCode}</span>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep("wallet");
                  }}
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to wallet step
                </button>
              </div>
            ) : null}

            {step === "code" ? (
              <div className="space-y-6">
                {existingAccountWallet ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-50 p-3 text-xs text-amber-800">
                    <p className="font-medium">You already have an ArcenPay account</p>
                    <p className="mt-1 leading-relaxed">
                      This email is linked to{" "}
                      <code className="font-mono">
                        {stellarShortAddress(existingAccountWallet)}
                      </code>
                      . Continuing links your{" "}
                      {isSolana ? "Solana" : isStellar ? "Stellar" : "EVM"} wallet to that
                      same account — your existing workspaces stay intact, and a{" "}
                      {isSolana ? "Solana" : isStellar ? "Stellar" : "EVM"} environment will be set up for your platform.
                    </p>
                  </div>
                ) : null}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {isStellar ? (
                    <>
                      <NetworkIcon
                        name="stellar"
                        variant="branded"
                        size={14}
                        className="rounded-full"
                      />
                      <span className="font-mono">
                        {stellarWallet.address
                          ? stellarShortAddress(stellarWallet.address)
                          : "Not connected"}
                      </span>
                    </>
                  ) : isSolana ? (
                    <>
                      <NetworkIcon
                        name="solana"
                        variant="branded"
                        size={14}
                        className="rounded-full"
                      />
                      <span className="font-mono">
                        {solanaWallet.address
                          ? stellarShortAddress(solanaWallet.address)
                          : "Not connected"}
                      </span>
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      <span className="font-mono">
                        {address ? shortAddress(address) : "Not connected"}
                      </span>
                    </>
                  )}
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">
                    Verification code
                  </label>
                  <InputOTP
                    maxLength={6}
                    value={code}
                    onChange={setCode}
                    containerClassName="justify-start"
                    className="w-full"
                  >
                    <InputOTPGroup className="gap-1.5 sm:gap-2">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <InputOTPSlot
                          key={index}
                          index={index}
                          className="h-10 w-10 sm:h-12 sm:w-12 rounded-md border text-sm sm:text-base"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                  {expiresAt ? (
                    <p className="text-xs text-muted-foreground">
                      Code expires at {new Date(expiresAt).toLocaleTimeString()}
                      .
                    </p>
                  ) : null}
                  {debugCode ? (
                    <p className="text-xs text-muted-foreground">
                      Dev fallback code:{" "}
                      <span className="font-mono">{debugCode}</span>
                    </p>
                  ) : null}
                </div>

                <Button
                  type="button"
                  onClick={submitCode}
                  disabled={isPending || isLinkingWallet || code.length !== 6}
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying
                    </>
                  ) : (
                    "Verify and continue"
                  )}
                </Button>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setCode("");
                      setStep("email");
                    }}
                    className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Change email
                  </button>

                  <button
                    type="button"
                    disabled={!canResend || isPending || isLinkingWallet}
                    onClick={submitEmail}
                    className="text-sm font-medium text-brand disabled:text-muted-foreground"
                  >
                    {canResend ? "Resend code" : `Resend in ${timerLabel}`}
                  </button>
                </div>
              </div>
            ) : null}

            {step === "sign" ? (
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {isStellar ? (
                    <>
                      <NetworkIcon
                        name="stellar"
                        variant="branded"
                        size={14}
                        className="rounded-full"
                      />
                      <span className="font-mono">
                        {stellarWallet.address
                          ? stellarShortAddress(stellarWallet.address)
                          : "Not connected"}
                      </span>
                    </>
                  ) : isSolana ? (
                    <>
                      <NetworkIcon
                        name="solana"
                        variant="branded"
                        size={14}
                        className="rounded-full"
                      />
                      <span className="font-mono">
                        {solanaWallet.address
                          ? stellarShortAddress(solanaWallet.address)
                          : "Not connected"}
                      </span>
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      <span className="font-mono">
                        {address ? shortAddress(address) : "Not connected"}
                      </span>
                    </>
                  )}
                </div>

                {chainFamily === "stellar" ? (
                  <>
                    {stellarWallet.address ? (
                      <div className="p-4 rounded-xl bg-brand/5 border border-brand/20">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-5 h-5 text-brand shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              Stellar wallet connected
                            </p>
                            <code className="text-xs font-mono text-muted-foreground">
                              {stellarShortAddress(stellarWallet.address)}
                            </code>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                        onClick={() => void stellarWallet.connect()}
                        disabled={
                          stellarWallet.isLoading || !stellarWallet.ready
                        }
                      >
                        {!stellarWallet.ready || stellarWallet.isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Initializing wallet kit...
                          </>
                        ) : (
                          <>
                            <NetworkIcon
                              name="stellar"
                              variant="branded"
                              size={18}
                              className="rounded-full mr-2"
                            />
                            Connect Stellar wallet
                          </>
                        )}
                      </Button>
                    )}
                    {stellarWallet.error ? (
                      <div className="text-sm text-red-600">
                        {stellarWallet.error}
                      </div>
                    ) : null}
                  </>
                ) : isSolana ? (
                  <>
                    {solanaWallet.address ? (
                      <div className="p-4 rounded-xl bg-brand/5 border border-brand/20">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-5 h-5 text-brand shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              Solana wallet connected
                            </p>
                            <code className="text-xs font-mono text-muted-foreground">
                              {stellarShortAddress(solanaWallet.address)}
                            </code>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                        onClick={() => void solanaWallet.connect()}
                        disabled={solanaWallet.isLoading}
                      >
                        {solanaWallet.isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          <>
                            <NetworkIcon
                              name="solana"
                              variant="branded"
                              size={18}
                              className="rounded-full mr-2"
                            />
                            Connect Solana wallet
                          </>
                        )}
                      </Button>
                    )}
                    {solanaWallet.error ? (
                      <div className="text-sm text-red-600">
                        {solanaWallet.error}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant={isConnected ? "outline" : "default"}
                      className="h-12 w-full"
                      onClick={() =>
                        void (isConnected
                          ? reconnectWallet()
                          : openConnectModal())
                      }
                    >
                      <Wallet className="mr-2 h-4 w-4" />
                      {isConnected ? "Change wallet" : "Connect wallet"}
                    </Button>

                    {isConnected && !isOnRequiredNetwork ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-12 w-full"
                        onClick={() => void switchToRequiredNetwork()}
                        disabled={isSwitchingChain}
                      >
                        {isSwitchingChain ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Switching network
                          </>
                        ) : (
                          `Switch to ${DEFAULT_WALLET_CHAIN_LABEL}`
                        )}
                      </Button>
                    ) : null}
                  </>
                )}

                <Button
                  type="button"
                  onClick={() => {
                    void linkWalletForSession();
                  }}
                  disabled={
                    isLinkingWallet ||
                    (isStellar
                      ? !stellarWallet.isConnected || !stellarWallet.address
                      : isSolana
                        ? !solanaWallet.isConnected || !solanaWallet.address
                        : !isConnected || !address || !isOnRequiredNetwork)
                  }
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                >
                  {isLinkingWallet ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing wallet
                    </>
                  ) : (
                    <>
                      <Shield className="mr-2 h-4 w-4" />
                      Sign wallet and continue
                    </>
                  )}
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep("code");
                  }}
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to code
                </button>
              </div>
            ) : null}

            {step === "activate" ? (
              <div className="space-y-6">
                {isPlatformAdminUser && (
                  <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 flex items-center justify-between text-xs text-blue-950 dark:text-blue-200">
                    <span>Platform Admin access active</span>
                    <a
                      href="/admin"
                      className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Admin Console &rarr;
                    </a>
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {isStellar ? (
                    <>
                      <NetworkIcon
                        name="stellar"
                        variant="branded"
                        size={14}
                        className="rounded-full"
                      />
                      <span className="font-mono">
                        {stellarWallet.address
                          ? stellarShortAddress(stellarWallet.address)
                          : "Connected"}
                      </span>
                    </>
                  ) : isSolana ? (
                    <>
                      <NetworkIcon
                        name="solana"
                        variant="branded"
                        size={14}
                        className="rounded-full"
                      />
                      <span className="font-mono">
                        {solanaWallet.address
                          ? stellarShortAddress(solanaWallet.address)
                          : "Connected"}
                      </span>
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      <span className="font-mono">
                        {address ? shortAddress(address) : "Connected"}
                      </span>
                    </>
                  )}
                  {email ? <span>· {email}</span> : null}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      Activation key
                    </label>
                    {verifyingKey ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> checking...
                      </span>
                    ) : null}
                  </div>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input
                      value={activationKey}
                      onChange={(e) =>
                        handleActivationKeyChange(e.target.value)
                      }
                      placeholder="ARCN-XXXX-XXXX-XXXX"
                      className="pl-10 font-mono tracking-wider uppercase text-sm h-12"
                      maxLength={19}
                      autoFocus
                    />
                  </div>
                </div>

                {keyVerification ? (
                  <div
                    className={`p-3 rounded-lg border text-xs ${
                      keyVerification.valid
                        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-950 dark:text-emerald-300"
                        : "border-red-500/30 bg-red-500/5 text-red-950 dark:text-red-300"
                    }`}
                  >
                    {keyVerification.valid && keyVerification.key ? (
                      <div className="space-y-1">
                        <div className="font-medium flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          <span>
                            Valid License:{" "}
                            <strong>{keyVerification.key.name}</strong>
                          </span>
                        </div>
                        <div className="text-muted-foreground text-[11px] flex gap-3 pt-1">
                          <span>
                            Tier:{" "}
                            <strong className="text-foreground">
                              {keyVerification.key.tier}
                            </strong>
                          </span>
                          <span>
                            Billing:{" "}
                            <strong className="text-foreground">
                              {keyVerification.key.allowPlatformBilling
                                ? "Self-Serve"
                                : "Managed"}
                            </strong>
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="font-medium flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                          <span>Invalid activation key</span>
                        </div>
                        <p className="text-[11px] opacity-90">
                          {keyVerification.reason === "KEY_NOT_FOUND" &&
                            "Key code not found. Please double-check for typos."}
                          {keyVerification.reason === "KEY_REVOKED" &&
                            "This activation key has been revoked."}
                          {keyVerification.reason === "KEY_EXPIRED" &&
                            "This activation key has expired."}
                          {keyVerification.reason === "KEY_EXHAUSTED" &&
                            "This activation key has reached its maximum redemption limit."}
                          {![
                            "KEY_NOT_FOUND",
                            "KEY_REVOKED",
                            "KEY_EXPIRED",
                            "KEY_EXHAUSTED",
                          ].includes(keyVerification.reason || "") &&
                            (keyVerification.reason || "Unable to verify key.")}
                        </p>
                        <div className="text-[11px] pt-1 border-t border-red-500/20">
                          <span>Need help? </span>
                          <a
                            href="https://www.arcenpay.com/contact"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium underline hover:opacity-80 inline-flex items-center gap-0.5"
                          >
                            Contact support{" "}
                            <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                <Button
                  type="button"
                  onClick={handleRedeemKey}
                  disabled={
                    redeemingKey ||
                    !activationKey.trim() ||
                    activationKey.length < 19 ||
                    (keyVerification !== null && !keyVerification.valid)
                  }
                  className="h-12 w-full bg-brand hover:bg-brand-dark text-primary-foreground"
                >
                  {redeemingKey ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Activating workspace...
                    </>
                  ) : (
                    "Activate and continue"
                  )}
                </Button>

                <div className="flex items-center justify-between gap-3 text-xs pt-2">
                  <a
                    href="https://www.arcenpay.com/contact"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:underline inline-flex items-center gap-1"
                  >
                    Don't have a key? Contact us{" "}
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Log out
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Right Side — Canvas Reveal Effect + Auto-rotating Testimonials */}
      <AuthMarketingPanel />
    </div>
  );
}
