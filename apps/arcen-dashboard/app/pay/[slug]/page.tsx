"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { isAddress, parseUnits } from "viem";
import { useAppKit } from "@reown/appkit/react";
import {
  CheckCircle2,
  Copy,
  Loader2,
  Wallet,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Shield,
  Clock,
  RefreshCw,
  User,
} from "lucide-react";
import { DEFAULT_CHAIN_ID, getChainLabel } from "@/lib/default-chain";

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

type PublicCheckoutSession = {
  id: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED" | "FAILED";
  purpose: "ADDON" | "INVOICE" | "CUSTOM";
  customerEmail?: string | null;
  customerWallet?: string | null;
  customerName?: string | null;
  currency: string;
  amount: string;
  acceptedToken: string;
  chainId: number;
  recipientWallet: string;
  txHash?: string | null;
  verificationError?: string | null;
  successUrl?: string | null;
  cancelUrl?: string | null;
  expiresAt?: string | null;
  paidAt?: string | null;
  paymentLink?: {
    id: string;
    name: string;
    slug: string;
    kind: string;
  } | null;
  catalogAddOn?: {
    id: string;
    name: string;
    description?: string | null;
  } | null;
  invoice?: {
    id: string;
    number?: string | null;
    status: string;
  } | null;
};

function normalizeCustomerEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidCustomerEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeWalletAddress(value?: string | null) {
  return value?.trim().toLowerCase() ?? null;
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
    >
      {copied ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </>
      )}
    </button>
  );
}

function useExpiryCountdown(expiresAt?: string | null) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    function tick() {
      const ms = new Date(expiresAt!).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining(0);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } else {
        setRemaining(Math.floor(ms / 1000));
      }
    }
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [expiresAt]);

  if (remaining === null) return null;
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Skeleton() {
  return (
    <div className="mt-20 flex flex-col items-center gap-4 text-neutral-500">
      <Loader2 className="h-8 w-8 animate-spin" />
      <p className="text-sm">Preparing your checkout…</p>
    </div>
  );
}

export default function HostedPaymentPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gradient-to-b from-neutral-50 to-neutral-100 px-4 py-8">
          <div className="mx-auto max-w-lg">
            <div className="mt-20 flex flex-col items-center gap-4 text-neutral-500">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Loading checkout…</p>
            </div>
          </div>
        </main>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}

function CheckoutContent() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const connectedChainId = useChainId();
  const { switchChainAsync, isPending: isSwitchingNetwork } = useSwitchChain();
  const { open } = useAppKit();
  const {
    writeContractAsync,
    isPending: isSending,
    error: sendError,
  } = useWriteContract();

  const [session, setSession] = useState<PublicCheckoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerWallet, setCustomerWallet] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [sentTxHash, setSentTxHash] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);

  const countdown = useExpiryCountdown(session?.expiresAt);
  const normalizedCustomerEmail = normalizeCustomerEmail(customerEmail);
  const missingCustomerEmail = normalizedCustomerEmail.length === 0;
  const invalidCustomerEmail =
    normalizedCustomerEmail.length > 0 &&
    !isValidCustomerEmail(normalizedCustomerEmail);
  const checkoutChainLabel = getChainLabel(session?.chainId ?? DEFAULT_CHAIN_ID);
  const amountFormatted = session ? Number(session.amount).toFixed(2) : "0.00";
  const productName =
    session?.catalogAddOn?.name ??
    session?.invoice?.number ??
    session?.paymentLink?.name ??
    "One-time payment";
  const isCorrectNetwork = !session || connectedChainId === session.chainId;
  const isSelfPayment =
    Boolean(session && address) &&
    normalizeWalletAddress(address) ===
      normalizeWalletAddress(session?.recipientWallet);
  const canSubmitPayment =
    !isSending &&
    !missingCustomerEmail &&
    !invalidCustomerEmail &&
    isCorrectNetwork &&
    !isSelfPayment;

  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: sentTxHash as `0x${string}` | undefined,
    query: { enabled: !!sentTxHash },
  });

  useEffect(() => {
    if (address && !customerWallet) {
      setCustomerWallet(address);
    }
  }, [address]);

  const persistCustomerDetails = useCallback(async () => {
    if (!session) return null;

    const res = await fetch(`/api/public/checkout/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerEmail: normalizedCustomerEmail,
        customerWallet: address ?? customerWallet ?? undefined,
        customerName: customerName.trim() || undefined,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      checkoutSession?: PublicCheckoutSession;
    };
    if (!res.ok || !payload.checkoutSession) {
      throw new Error(payload.error || "Unable to save billing details.");
    }

    setSession(payload.checkoutSession);
    return payload.checkoutSession;
  }, [
    address,
    customerName,
    customerWallet,
    normalizedCustomerEmail,
    session,
  ]);

  const verifyOnBackend = useCallback(
    async (txHash: string) => {
      if (!session) return;
      setVerifying(true);
      setVerificationFailed(false);
      try {
        const res = await fetch(`/api/public/checkout/${session.id}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txHash,
            senderWallet: address,
          }),
        });
        const payload = (await res.json()) as {
          error?: string;
          checkoutSession?: PublicCheckoutSession;
        };
        if (!res.ok || !payload.checkoutSession) {
          throw new Error(payload.error || "Verification failed.");
        }
        setSession(payload.checkoutSession);
        if (payload.checkoutSession.successUrl) {
          window.location.assign(payload.checkoutSession.successUrl);
        }
      } catch (err) {
        setVerificationFailed(true);
        setError(err instanceof Error ? err.message : "Verification failed.");
      } finally {
        setVerifying(false);
      }
    },
    [session, address],
  );

  useEffect(() => {
    if (receipt && receipt.status === "success" && sentTxHash && !verifying && session?.status === "PENDING") {
      void verifyOnBackend(sentTxHash);
    }
  }, [receipt, sentTxHash, verifying, session?.status, verifyOnBackend]);

  useEffect(() => {
    let cancelled = false;
    async function loadOrCreateSession() {
      try {
        setLoading(true);
        setError(null);
        const existingSessionId = searchParams.get("session");
        if (existingSessionId) {
          const res = await fetch(`/api/public/checkout/${existingSessionId}`, {
            cache: "no-store",
          });
          if (!res.ok) throw new Error("Checkout session not found or expired.");
          const payload = (await res.json()) as {
            checkoutSession: PublicCheckoutSession;
          };
          if (!cancelled) {
            setSession(payload.checkoutSession);
            setCustomerEmail(payload.checkoutSession.customerEmail ?? "");
            setCustomerWallet(payload.checkoutSession.customerWallet ?? "");
            setCustomerName(payload.checkoutSession.customerName ?? "");
          }
          return;
        }

        const createRes = await fetch(
          `/api/public/payment-links/${params.slug}/session`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerEmail: customerEmail || undefined,
              customerWallet: customerWallet || undefined,
              customerName: customerName || undefined,
            }),
          },
        );
        const payload = (await createRes.json()) as {
          error?: string;
          checkoutSession?: PublicCheckoutSession;
        };
        if (!createRes.ok || !payload.checkoutSession) {
          throw new Error(payload.error || "Unable to create checkout session.");
        }
        if (!cancelled) {
          setSession(payload.checkoutSession);
          const next = new URLSearchParams(searchParams.toString());
          next.set("session", payload.checkoutSession.id);
          router.replace(`/pay/${params.slug}?${next.toString()}`);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load checkout.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadOrCreateSession();
    return () => { cancelled = true; };
  }, [params.slug]);

  async function handlePay() {
    if (!session || !address) return;
    setError(null);
    setVerificationFailed(false);
    try {
      if (missingCustomerEmail || invalidCustomerEmail) {
        setError("Enter a valid billing email before paying.");
        return;
      }

      if (!isCorrectNetwork) {
        setError(`Switch your wallet to ${checkoutChainLabel} before paying.`);
        return;
      }

      if (isSelfPayment) {
        setError(
          "The connected wallet matches the recipient wallet. Use a different payer wallet or change the payment link recipient.",
        );
        return;
      }

      if (!isAddress(session.acceptedToken)) {
        setError("This checkout session has an invalid token contract.");
        return;
      }

      await persistCustomerDetails();

      const amountAtomic = parseUnits(session.amount, 6);
      const hash = await writeContractAsync({
        address: session.acceptedToken as `0x${string}`,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [session.recipientWallet as `0x${string}`, amountAtomic],
      });
      setSentTxHash(hash);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Transaction failed";
      if (!errMsg.includes("User rejected") && !errMsg.includes("User denied")) {
        setError(errMsg);
      }
    }
  }

  async function handleRetry() {
    setError(null);
    setSentTxHash(null);
    setVerificationFailed(false);
    setLoading(true);
    try {
      const createRes = await fetch(
        `/api/public/payment-links/${params.slug}/session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerEmail: normalizedCustomerEmail || undefined,
            customerWallet: address ?? customerWallet ?? undefined,
            customerName: customerName.trim() || undefined,
          }),
        },
      );
      const payload = (await createRes.json()) as {
        error?: string;
        checkoutSession?: PublicCheckoutSession;
      };
      if (!createRes.ok || !payload.checkoutSession) {
        throw new Error(payload.error || "Unable to create checkout session.");
      }
      setSession(payload.checkoutSession);
      const next = new URLSearchParams();
      next.set("session", payload.checkoutSession.id);
      router.replace(`/pay/${params.slug}?${next.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load checkout.");
    } finally {
      setLoading(false);
    }
  }

  const showConnect = !isConnected && session?.status === "PENDING";
  const showPay = isConnected && session?.status === "PENDING" && !sentTxHash && !verificationFailed;
  const showProcessing = sentTxHash && (isConfirming || isSending || verifying) && session?.status === "PENDING";
  const showError =
    sendError ||
    verificationFailed ||
    (error && session?.status === "PENDING" && !sentTxHash && !verifying);
  const showReceiptError =
    receipt && receipt.status === "reverted" && session?.status === "PENDING";

  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-50 to-neutral-100 px-4 py-8">
      <div className="mx-auto max-w-lg">
        {loading && <Skeleton />}

        {/* Error state */}
        {!loading && error && !session && (
          <div className="mt-10 rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
            <XCircle className="mx-auto h-12 w-12 text-red-400" />
            <h1 className="mt-4 text-xl font-semibold text-neutral-900">Checkout unavailable</h1>
            <p className="mt-2 text-sm text-neutral-600">{error}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          </div>
        )}

        {/* Already PAID */}
        {!loading && session?.status === "PAID" && (
          <div className="mt-10 space-y-6">
            <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-9 w-9 text-emerald-500" />
              </div>
              <h1 className="mt-4 text-2xl font-semibold text-neutral-900">Payment confirmed</h1>
              <p className="mt-2 text-sm text-neutral-600">
                Your {amountFormatted} {session.currency} payment has been verified on-chain.
              </p>
              {session.txHash && (
                <p className="mt-3 break-all font-mono text-xs text-neutral-500">{session.txHash}</p>
              )}
              {session.successUrl && (
                <a
                  href={session.successUrl}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* EXPIRED / CANCELLED / FAILED */}
        {!loading &&
          session &&
          (session.status === "EXPIRED" || session.status === "CANCELLED" || session.status === "FAILED") && (
            <div className="mt-10 rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
                <Clock className="h-9 w-9 text-amber-500" />
              </div>
              <h1 className="mt-4 text-xl font-semibold text-neutral-900">
                {session.status === "EXPIRED" ? "Session expired" : session.status === "CANCELLED" ? "Session cancelled" : "Payment failed"}
              </h1>
              <p className="mt-2 text-sm text-neutral-600">
                {session.status === "EXPIRED"
                  ? "This checkout session has expired."
                  : session.status === "CANCELLED"
                    ? "This checkout session has been cancelled."
                    : session.verificationError ?? "The payment could not be verified."}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Create new session
              </button>
            </div>
          )}

        {/* PENDING — active checkout */}
        {!loading && session?.status === "PENDING" && (
          <div className="space-y-5">
            {/* Header */}
            <div className="text-center">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
                ArcenPay Hosted Checkout
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-900">
                {productName}
              </h1>
            </div>

            {/* Payment card */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">Amount due</p>
                  <p className="mt-1 text-4xl font-semibold tracking-tight text-neutral-900">
                    ${amountFormatted}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">{session.currency}</p>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700">
                  <Shield className="h-3.5 w-3.5" />
                  {checkoutChainLabel}
                </div>
              </div>
              {countdown && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <Clock className="h-3.5 w-3.5" />
                  Expires in <span className="font-mono font-medium">{countdown}</span>
                </div>
              )}
            </div>

            {/* Customer info */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="mb-4 text-sm font-medium text-neutral-900">Your details</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs text-neutral-600">
                    <User className="h-3.5 w-3.5" /> Email
                  </span>
                  <input
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-sm outline-none transition focus:border-neutral-400 focus:bg-white"
                    placeholder="you@company.com"
                  />
                  <p
                    className={
                      missingCustomerEmail || invalidCustomerEmail
                        ? "text-xs text-red-600"
                        : "text-xs text-neutral-500"
                    }
                  >
                    {missingCustomerEmail || invalidCustomerEmail
                      ? "Enter a valid billing email so we can send the invoice and receipt."
                      : "We’ll email the invoice and payment receipt to this address."}
                  </p>
                </label>
                <label className="space-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs text-neutral-600">
                    <User className="h-3.5 w-3.5" /> Name
                  </span>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-sm outline-none transition focus:border-neutral-400 focus:bg-white"
                    placeholder="Your name"
                  />
                </label>
              </div>
            </div>

            {/* Payment flow */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="mb-4 text-sm font-medium text-neutral-900">Payment</p>

              {/* Connect wallet step */}
              {showConnect && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-sm font-semibold text-blue-600">
                        1
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-neutral-900">Connect your wallet</p>
                        <p className="mt-1 text-xs text-neutral-600">
                          Connect any wallet to pay {session.amount} {session.currency} on {checkoutChainLabel}. MetaMask, WalletConnect, Coinbase Wallet, and more are supported.
                        </p>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => open()}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
                  >
                    <Wallet className="h-4 w-4" />
                    Connect wallet
                  </button>
                </div>
              )}

              {/* Pay step */}
              {showPay && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-semibold text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-neutral-900">Wallet connected</p>
                        <p className="mt-1 break-all font-mono text-xs text-neutral-600">{address}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => open()}
                        className="shrink-0 text-xs text-blue-600 hover:text-blue-800"
                      >
                        Change
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-sm font-semibold text-blue-600">
                        2
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-neutral-900">Send payment</p>
                        <div className="mt-3 space-y-2 text-xs text-neutral-600">
                          <div className="flex items-center justify-between">
                            <span>Send to</span>
                            <span className="font-mono">{session.recipientWallet.slice(0, 8)}…{session.recipientWallet.slice(-6)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Amount</span>
                            <span className="font-medium text-neutral-900">
                              {Number(session.amount).toFixed(2)} {session.currency}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Network</span>
                            <span>{checkoutChainLabel}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Token contract</span>
                            <span className="font-mono">
                              {session.acceptedToken.slice(0, 8)}…{session.acceptedToken.slice(-6)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {!isCorrectNetwork && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                        <div className="space-y-3">
                          <div>
                            <p className="text-sm font-medium text-amber-900">Wrong network</p>
                            <p className="mt-1 text-xs text-amber-800">
                              This checkout is for {checkoutChainLabel}. Switch networks before paying.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void switchChainAsync({ chainId: session.chainId })}
                            disabled={isSwitchingNetwork}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-amber-100 px-4 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isSwitchingNetwork ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Switching network…
                              </>
                            ) : (
                              <>Switch to {checkoutChainLabel}</>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {isSelfPayment && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                        <div>
                          <p className="text-sm font-medium text-amber-900">Recipient matches payer</p>
                          <p className="mt-1 text-xs text-amber-800">
                            This link is currently set to send funds back to the same wallet that is paying. No net USDC will move. Use a different payer wallet or update the payment link recipient.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex items-start gap-3">
                      <Shield className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                      <div>
                        <p className="text-sm font-medium text-blue-900">Why your wallet shows 0 ETH</p>
                        <p className="mt-1 text-xs text-blue-800">
                          This checkout sends USDC through the token contract, so many wallets show 0 ETH at the top. The actual payment amount is the USDC transfer in the transaction data, and the real recipient is the wallet shown above.
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handlePay}
                    disabled={!canSubmitPayment}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Confirm in wallet…
                      </>
                    ) : (
                      <>
                        <Wallet className="h-4 w-4" />
                        Pay ${amountFormatted}
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Processing step */}
              {showProcessing && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-semibold text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-neutral-900">Wallet connected</p>
                        <p className="mt-1 break-all font-mono text-xs text-neutral-600">{address}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-4 py-8">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-medium text-neutral-900">
                        {isSending
                          ? "Confirm in wallet"
                          : isConfirming
                            ? "Waiting for confirmation"
                            : verifying
                              ? "Verifying payment"
                              : "Processing"}
                      </p>
                      <p className="mt-1 text-sm text-neutral-600">
                        {isSending
                          ? "Approve the transaction in your wallet app."
                          : isConfirming
                            ? "Waiting for the blockchain to confirm your transfer."
                            : verifying
                              ? "ArcenPay is verifying your on-chain payment."
                              : ""}
                      </p>
                    </div>
                    {sentTxHash && (
                      <p className="break-all font-mono text-xs text-neutral-500">{sentTxHash}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Transaction reverted */}
              {showReceiptError && !isConfirming && !verifying && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Transaction reverted on-chain. Please try again.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSentTxHash(null);
                      setVerificationFailed(false);
                    }}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white text-sm font-medium text-neutral-900 hover:bg-neutral-50 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try again
                  </button>
                </div>
              )}

              {/* Verification failed — retry */}
              {verificationFailed && !verifying && sentTxHash && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {error ?? "Verification failed. The transaction may still be confirming. You can retry."}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVerificationFailed(false);
                      void verifyOnBackend(sentTxHash);
                    }}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-100 text-sm font-medium text-amber-900 hover:bg-amber-200 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry verification
                  </button>
                </div>
              )}

              {/* Payment error */}
              {showError && !isSending && !isConfirming && !verifying && !verificationFailed && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {sendError
                        ? ((sendError as { shortMessage?: string }).shortMessage ?? (sendError as Error).message)
                        : error || "Transaction failed"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setSentTxHash(null);
                    }}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white text-sm font-medium text-neutral-900 hover:bg-neutral-50 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try again
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="rounded-2xl border border-neutral-200 bg-white/80 p-4 text-center text-xs text-neutral-500">
              <div className="flex items-center justify-center gap-2">
                <Shield className="h-3.5 w-3.5" />
                Powered by ArcenPay — secure on-chain USDC payments on {checkoutChainLabel}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
