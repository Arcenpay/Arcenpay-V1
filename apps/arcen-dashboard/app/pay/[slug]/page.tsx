"use client";
import { apiFetch } from "@/lib/api-client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { isAddress, parseUnits } from "viem";
import { useAppKit } from "@reown/appkit/react";
import { isStellarChainId, isSolanaChainId, getStellarNetworkPassphrase, getSolanaRpcUrl } from "@arcenpay/internal-core";
import { useStellarWallet } from "@/hooks/use-stellar-wallet";
import { useSolanaWallet } from "@/hooks/use-solana-wallet";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Loader2,
  MapPinHouse,
  Globe,
  Wallet,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Shield,
  Clock,
  RefreshCw,
  Bot,
  Code2,
  Copy,
  Check,
} from "lucide-react";
import { Web3Icon } from "@/components/web3-icon";
import { DEFAULT_CHAIN_ID, getChainLabel } from "@/lib/default-chain";
import { readPaymentLinkCheckoutAppearance } from "@/lib/payment-link-checkout";

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

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const KNOWN_STELLAR_USDC_ISSUERS = {
  GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5: "USDC",
  GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5REQK4DVZWA: "USDC",
} as const;

const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
const STELLAR_CONTRACT_REGEX = /^C[A-Z0-9]{55}$/;

function horizonUrlForPassphrase(passphrase: string): string {
  return passphrase.includes("Test")
    ? "https://horizon-testnet.stellar.org"
    : "https://horizon.stellar.org";
}

function stellarAddressMatches(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const x = a.trim();
  const y = b.trim();
  if (STELLAR_ACCOUNT_REGEX.test(x) || STELLAR_ACCOUNT_REGEX.test(y)) {
    // Stellar addresses are case-sensitive base32 — compare exactly.
    return x === y;
  }
  return x.toLowerCase() === y.toLowerCase();
}

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
  chainFamily?: "EVM" | "STELLAR" | "SOLANA" | null;
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
    description?: string | null;
    slug: string;
    kind: string;
    isAgentic?: boolean;
    metadata?: Record<string, unknown> | null;
    company?: {
      id: string;
      name: string;
      email?: string | null;
      walletAddress?: string | null;
      logoUrl?: string | null;
    } | null;
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

function normalizeCustomerName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isValidCustomerEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeWalletAddress(value?: string | null) {
  return value?.trim().toLowerCase() ?? null;
}

function getAccentTextColor(accent: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return "#ffffff";
  const red = Number.parseInt(accent.slice(1, 3), 16);
  const green = Number.parseInt(accent.slice(3, 5), 16);
  const blue = Number.parseInt(accent.slice(5, 7), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 170 ? "#111111" : "#ffffff";
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
    <div className="pt-6 sm:pt-10">
      <div className="mx-auto max-w-[110rem] overflow-hidden border border-[#e5e7eb] bg-white shadow-[0_20px_60px_-40px_rgba(15,23,42,0.28)] lg:grid lg:grid-cols-[1.02fr_0.98fr]">
        <section className="bg-[#f5f5f7] px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
          <div className="h-4 w-16 animate-pulse rounded bg-[#d8dbe2]" />
          <div className="mt-7 flex items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-full bg-[#d8dbe2]" />
            <div className="space-y-2">
              <div className="h-4 w-32 animate-pulse rounded bg-[#d8dbe2]" />
              <div className="h-3 w-20 animate-pulse rounded bg-[#e1e4ea]" />
            </div>
          </div>
          <div className="mt-8 h-4 w-24 animate-pulse rounded bg-[#d8dbe2]" />
          <div className="mt-3 h-12 w-40 animate-pulse rounded bg-[#d8dbe2]" />
          <div className="mt-5 space-y-3">
            <div className="h-3 w-full animate-pulse rounded bg-[#e1e4ea]" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-[#e1e4ea]" />
          </div>
          <div className="mt-10 rounded-2xl bg-white p-6 ring-1 ring-[#eceff4]">
            <div className="h-5 w-32 animate-pulse rounded bg-[#d8dbe2]" />
            <div className="mt-6 h-16 animate-pulse rounded-2xl bg-[#eef1f5]" />
            <div className="mt-6 space-y-3">
              <div className="h-3 w-full animate-pulse rounded bg-[#e1e4ea]" />
              <div className="h-3 w-full animate-pulse rounded bg-[#e1e4ea]" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-[#e1e4ea]" />
            </div>
          </div>
        </section>
        <section className="px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
          <div className="h-12 w-full animate-pulse rounded-lg bg-[#111111]" />
          <div className="my-7 flex items-center gap-4">
            <div className="h-px flex-1 bg-[#e7e9ef]" />
            <div className="h-3 w-8 animate-pulse rounded bg-[#e1e4ea]" />
            <div className="h-px flex-1 bg-[#e7e9ef]" />
          </div>
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="h-4 w-24 animate-pulse rounded bg-[#d8dbe2]" />
              <div className="h-12 w-full animate-pulse rounded-xl bg-[#f5f6f8]" />
            </div>
            <div className="space-y-3">
              <div className="h-4 w-28 animate-pulse rounded bg-[#d8dbe2]" />
              <div className="h-16 w-full animate-pulse rounded-xl bg-[#f5f6f8]" />
            </div>
            <div className="space-y-3">
              <div className="h-4 w-32 animate-pulse rounded bg-[#d8dbe2]" />
              <div className="h-12 w-full animate-pulse rounded-xl bg-[#f5f6f8]" />
              <div className="h-12 w-full animate-pulse rounded-xl bg-[#f5f6f8]" />
              <div className="h-12 w-full animate-pulse rounded-xl bg-[#f5f6f8]" />
            </div>
            <div className="h-14 w-full animate-pulse rounded-lg bg-[#111111]" />
          </div>
        </section>
      </div>
    </div>
  );
}

function AgenticPaymentLinkPanel({
  slug,
  amount,
  currency,
  chainId,
  origin,
}: {
  slug: string;
  amount: string;
  currency: string;
  chainId: number;
  origin: string;
}) {
  const [activeTab, setActiveTab] = useState<"sdk" | "curl" | "mcp">("sdk");
  const [copied, setCopied] = useState(false);
  const specUrl = `${origin}/api/v1/public/payment-links/${slug}/spec`;
  const payUrl = `${origin}/pay/${slug}`;

  const sdkCode = `import { ArcenAgent } from "@arcenpay/agent";

const agent = new ArcenAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  chainId: ${chainId},
});

// Autonomous payment: discovers requirements, enforces limits & transfers on-chain
const receipt = await agent.payPaymentLink("${payUrl}");
console.log("Payment settled:", receipt.txHash);`;

  const curlCode = `# 1. Discover machine-readable specification
curl -s -H "Accept: application/json" \\
  "${specUrl}"

# 2. Or create a checkout session directly
curl -s -X POST "${origin}/api/v1/public/payment-links/${slug}/session" \\
  -H "Content-Type: application/json" \\
  -d '{"customerWallet": "0xYourWalletAddress", "isAgentic": true}'`;

  const mcpCode = `{
  "tool": "arcenpay_pay_payment_link",
  "arguments": {
    "urlOrSlug": "${payUrl}",
    "maxPrice": "${amount}",
    "customerName": "Autonomous AI Agent"
  }
}`;

  const currentCode =
    activeTab === "sdk" ? sdkCode : activeTab === "curl" ? curlCode : mcpCode;

  const handleCopy = () => {
    void navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-[#e2e4e9] bg-white shadow-[0_4px_24px_-8px_rgba(15,23,42,0.06)]">
      <div className="border-b border-[#eceef2] bg-[#fafbfc] px-5 py-3.5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#111318] text-white shadow-sm">
              <Bot className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#12161d]">
                  Agentic Payment Link
                </span>
                <span className="rounded-md border border-[#e2e4e9] bg-white px-1.5 py-0.2 text-[10px] font-medium text-[#5f6470]">
                  Autonomous
                </span>
              </div>
              <p className="text-[11px] text-[#7a7f89]">
                Machine-readable specification &amp; autonomous agent execution
              </p>
            </div>
          </div>
          <a
            href={specUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#d8dbe2] bg-white px-2.5 py-1 text-xs font-medium text-[#1f232b] transition hover:bg-[#f4f5f7] hover:border-[#c5c8d1]"
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>Open Spec JSON</span>
          </a>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between border-b border-[#eceef2] pb-3">
          <div className="flex items-center gap-1 rounded-lg bg-[#f0f1f4] p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab("sdk")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                activeTab === "sdk"
                  ? "bg-white text-[#111318] shadow-sm"
                  : "text-[#6f7480] hover:text-[#111318]"
              }`}
            >
              TypeScript SDK
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("mcp")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                activeTab === "mcp"
                  ? "bg-white text-[#111318] shadow-sm"
                  : "text-[#6f7480] hover:text-[#111318]"
              }`}
            >
              MCP Tool Call
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("curl")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                activeTab === "curl"
                  ? "bg-white text-[#111318] shadow-sm"
                  : "text-[#6f7480] hover:text-[#111318]"
              }`}
            >
              cURL
            </button>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#d8dbe2] bg-white px-2.5 py-1 text-xs font-medium text-[#1f232b] transition hover:bg-[#f4f5f7]"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-emerald-600">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-[#5f6470]" />
                <span>Copy Code</span>
              </>
            )}
          </button>
        </div>

        <div className="mt-3.5 overflow-x-auto rounded-xl border border-[#23272f] bg-[#0c0e12] p-4 text-xs font-mono text-[#e1e4ea] shadow-inner">
          <pre className="whitespace-pre leading-relaxed">{currentCode}</pre>
        </div>
      </div>
    </div>
  );
}

export default function HostedPaymentPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen overflow-hidden bg-[#f6f4f1] px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <Skeleton />
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
  const [billingCountry, setBillingCountry] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [sentTxHash, setSentTxHash] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [solanaBalance, setSolanaBalance] = useState<number | null>(null);
  const [stellarBalance, setStellarBalance] = useState<number | null>(null);

  // Stellar wallet (StellarWalletsKit: Freighter/xBull/Albedo/Lobstr).
  // Only active when the checkout session is on a Stellar chain. The chainId
  // arrives with the session; the hook re-initializes its network when it
  // changes so mainnet checkouts sign with the PUBLIC passphrase.
  const stellar = useStellarWallet(
    isStellarChainId(session?.chainId ?? 0)
      ? (session?.chainId as number)
      : 9_000_001,
  );

  // Solana wallet (injected provider: Phantom/Solflare/…).
  const solana = useSolanaWallet(
    isSolanaChainId(session?.chainId ?? 0)
      ? (session?.chainId as number)
      : 9_100_001,
  );

  // EVM token balance
  const isEvmToken = Boolean(
    session &&
      session.chainFamily !== "STELLAR" &&
      session.chainFamily !== "SOLANA" &&
      session.acceptedToken &&
      isAddress(session.acceptedToken),
  );
  const { data: rawPayerBalance } = useReadContract({
    address: session?.acceptedToken as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address && isEvmToken),
      refetchInterval: 10_000,
    },
  });

  const countdown = useExpiryCountdown(session?.expiresAt);
  const normalizedCustomerEmail = normalizeCustomerEmail(customerEmail);
  const normalizedCustomerName = normalizeCustomerName(customerName);
  const missingCustomerName = normalizedCustomerName.length === 0;
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
  const productDescription =
    session?.catalogAddOn?.description ??
    session?.paymentLink?.description ??
    (session?.invoice
      ? "Complete this invoice securely with an on-chain USDC payment."
      : "Securely complete this hosted checkout with your wallet.");
  const paymentLinkKindLabel =
    session?.paymentLink?.kind === "INVOICE"
      ? "Invoice checkout"
      : session?.paymentLink?.kind === "ADDON"
        ? "Add-on checkout"
        : "Hosted checkout";
  const billingCadenceLabel =
    session?.purpose === "INVOICE"
      ? "One-time invoice payment"
      : session?.purpose === "ADDON"
        ? "Add-on purchase"
        : "One-time hosted payment";
  const checkoutAppearance = readPaymentLinkCheckoutAppearance(
    session?.paymentLink?.metadata,
  );
  const merchantName =
    checkoutAppearance.brandName ||
    session?.paymentLink?.company?.name ||
    session?.paymentLink?.name ||
    "ArcenPay";
  const merchantLogoUrl =
    checkoutAppearance.logoUrl || session?.paymentLink?.company?.logoUrl || "";
  const recipientDisplayName =
    checkoutAppearance.recipientName ||
    session?.paymentLink?.company?.name ||
    merchantName;
  const displayTitle = checkoutAppearance.title || productName;
  const displayDescription =
    checkoutAppearance.description || productDescription;
  const payButtonLabel =
    checkoutAppearance.buttonLabel ||
    (session?.purpose === "INVOICE"
      ? "Pay invoice"
      : session?.purpose === "ADDON"
        ? "Complete purchase"
        : "Complete payment");
  const accentColor = checkoutAppearance.accentColor || "#111111";
  const accentSoftColor =
    accentColor.length === 7 ? `${accentColor}1a` : accentColor;
  const accentTextColor = getAccentTextColor(accentColor);
  const isStellar = Boolean(session && session.chainFamily === "STELLAR");
  const isSolana = Boolean(session && session.chainFamily === "SOLANA");

  // Solana token balance
  useEffect(() => {
    if (!isSolana || !solana.address || !session?.chainId || !session.acceptedToken) {
      setSolanaBalance(null);
      return;
    }
    let cancelled = false;
    async function loadSolanaBal() {
      try {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const rpcUrl = getSolanaRpcUrl(session!.chainId);
        if (!rpcUrl) return;
        const connection = new Connection(rpcUrl, "confirmed");
        const accounts = await connection.getParsedTokenAccountsByOwner(
          new PublicKey(solana.address!),
          { mint: new PublicKey(session!.acceptedToken) },
        );
        if (cancelled) return;
        const total = accounts.value.reduce((sum, { account }) => {
          const amt = (account.data as any)?.parsed?.info?.tokenAmount?.uiAmount;
          return sum + (typeof amt === "number" ? amt : 0);
        }, 0);
        setSolanaBalance(total);
      } catch {
        // ignore
      }
    }
    void loadSolanaBal();
    return () => {
      cancelled = true;
    };
  }, [isSolana, solana.address, session?.chainId, session?.acceptedToken]);

  // Stellar token balance
  useEffect(() => {
    if (!isStellar || !stellar.address || !session?.chainId) {
      setStellarBalance(null);
      return;
    }
    let cancelled = false;
    async function loadStellarBal() {
      try {
        const passphrase = getStellarNetworkPassphrase(session!.chainId);
        const horizonUrl = horizonUrlForPassphrase(passphrase);
        const res = await fetch(`${horizonUrl}/accounts/${stellar.address}`);
        if (!res.ok || cancelled) return;
        const acc = await res.json();
        const usdc = acc.balances?.find((b: any) => b.asset_code === "USDC");
        if (usdc && "balance" in usdc && !cancelled) {
          setStellarBalance(parseFloat(usdc.balance));
        }
      } catch {
        // ignore
      }
    }
    void loadStellarBal();
    return () => {
      cancelled = true;
    };
  }, [isStellar, stellar.address, session?.chainId]);

  const payerBalanceNumber = isStellar
    ? stellarBalance
    : isSolana
      ? solanaBalance
      : rawPayerBalance !== undefined
        ? Number(rawPayerBalance) / 1e6
        : null;

  const isAgentic = Boolean(
    session?.paymentLink &&
      (session.paymentLink.isAgentic ||
        (session.paymentLink.metadata &&
          typeof session.paymentLink.metadata === "object" &&
          (session.paymentLink.metadata as Record<string, unknown>).isAgentic)),
  );
  const isCorrectNetwork =
    !session || isStellar || isSolana || connectedChainId === session.chainId;
  const isSelfPayment = Boolean(session) &&
    (isStellar
      ? stellarAddressMatches(stellar.address, session?.recipientWallet)
      : isSolana
        ? solana.address === session?.recipientWallet
        : stellarAddressMatches(address, session?.recipientWallet));

  const isExpired = Boolean(
    session?.status === "EXPIRED" ||
      (session?.expiresAt &&
        new Date(session.expiresAt).getTime() <= Date.now()) ||
      countdown === "0:00",
  );

  const walletConnectedForBalance = isStellar
    ? stellar.isConnected
    : isSolana
      ? solana.isConnected
      : isConnected;

  const isInsufficientBalance = Boolean(
    walletConnectedForBalance &&
      payerBalanceNumber !== null &&
      session &&
      payerBalanceNumber < Number(session.amount),
  );

  const canSubmitPayment =
    !isSending &&
    !isSubmitting &&
    !missingCustomerName &&
    !missingCustomerEmail &&
    !invalidCustomerEmail &&
    isCorrectNetwork &&
    !isSelfPayment &&
    !isInsufficientBalance &&
    !isExpired;

  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: sentTxHash as `0x${string}` | undefined,
    query: { enabled: !!sentTxHash },
  });

  useEffect(() => {
    const connected = isStellar
      ? stellar.address
      : isSolana
        ? solana.address
        : address;
    if (connected && !customerWallet) {
      setCustomerWallet(connected);
    }
  }, [address, stellar.address, solana.address, isStellar, isSolana, customerWallet]);

  const persistCustomerDetails = useCallback(async () => {
    if (!session) return null;

    const res = await apiFetch(`/api/public/checkout/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerEmail: normalizedCustomerEmail,
        customerWallet: isStellar
          ? (stellar.address ?? customerWallet ?? undefined)
          : isSolana
            ? (solana.address ?? customerWallet ?? undefined)
            : (address ?? customerWallet ?? undefined),
        customerName: normalizedCustomerName || undefined,
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
    stellar.address,
    solana.address,
    isStellar,
    isSolana,
    customerWallet,
    normalizedCustomerEmail,
    normalizedCustomerName,
    session,
  ]);

  const verifyOnBackend = useCallback(
    async (txHash: string) => {
      if (!session) return;
      setVerifying(true);
      setVerificationFailed(false);
      try {
        const res = await apiFetch(`/api/public/checkout/${session.id}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txHash,
            senderWallet: isStellar
              ? stellar.address
              : isSolana
                ? solana.address
                : address,
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
    [session, isStellar, isSolana, stellar.address, solana.address, address],
  );

  // EVM: wait for the tx receipt then verify on the backend.
  // Stellar: verification runs directly after submit (no wagmi receipt watcher).
  useEffect(() => {
    if (
      !isStellar &&
      receipt &&
      receipt.status === "success" &&
      sentTxHash &&
      !verifying &&
      session?.status === "PENDING"
    ) {
      void verifyOnBackend(sentTxHash);
    }
  }, [receipt, sentTxHash, verifying, session?.status, verifyOnBackend, isStellar]);

  useEffect(() => {
    let cancelled = false;
    async function loadOrCreateSession() {
      try {
        setLoading(true);
        setError(null);
        const existingSessionId = searchParams.get("session");
        if (existingSessionId) {
          const res = await apiFetch(`/api/public/checkout/${existingSessionId}`, {
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

        const createRes = await apiFetch(
          `/api/public/payment-links/${params.slug}/session`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerEmail: customerEmail || undefined,
              customerWallet: customerWallet || undefined,
              customerName: normalizedCustomerName || undefined,
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

  async function handleStellarPay() {
    if (!session || !stellar.address) return;
    // Validate the recipient before building/popup signing — fail fast with a
    // clear message instead of a Horizon error after the wallet popup.
    if (!STELLAR_ACCOUNT_REGEX.test(session.recipientWallet)) {
      throw new Error("This checkout has an invalid Stellar recipient wallet.");
    }
    const { Asset, Horizon, TransactionBuilder, Operation, BASE_FEE } =
      await import("@stellar/stellar-sdk");

    const passphrase = getStellarNetworkPassphrase(session.chainId);
    const horizonUrl = horizonUrlForPassphrase(passphrase);
    const server = new Horizon.Server(horizonUrl);

    // acceptedToken is either a G… SAC issuer or a C… SAC contract id.
    let issuer = session.acceptedToken;
    if (STELLAR_CONTRACT_REGEX.test(issuer)) {
      const opsRes = await apiFetch(
        `${horizonUrl}/accounts/${stellar.address}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!opsRes.ok) {
        throw new Error("Unable to resolve the token issuer for this checkout.");
      }
      const accountData = (await opsRes.json()) as {
        balances?: Array<{ asset_code?: string; asset_issuer?: string }>;
      };
      const match = accountData.balances?.find((b) => b.asset_issuer);
      if (!match?.asset_issuer) {
        throw new Error("Unable to resolve the token issuer for this checkout.");
      }
      issuer = match.asset_issuer;
    }
    if (!STELLAR_ACCOUNT_REGEX.test(issuer)) {
      throw new Error("This checkout session has an invalid token issuer.");
    }
    const assetCode = KNOWN_STELLAR_USDC_ISSUERS[issuer as keyof typeof KNOWN_STELLAR_USDC_ISSUERS] ?? "USDC";
    const asset = new Asset(assetCode, issuer);

    const payer = await server.loadAccount(stellar.address);
    const tx = new TransactionBuilder(payer, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.payment({
          destination: session.recipientWallet,
          asset,
          amount: session.amount,
        }),
      )
      .setTimeout(300)
      .build();

    const { signedTxXdr } = await stellar.signTransaction(tx.toXDR(), {
      networkPassphrase: passphrase,
      address: stellar.address,
    });
    const signedTx = TransactionBuilder.fromXDR(signedTxXdr, passphrase);
    const submitted = await server.submitTransaction(signedTx);
    const hash = submitted.hash;
    setSentTxHash(hash);
    await verifyOnBackend(hash);
  }

  /**
   * Solana payment: sends an SPL `TransferChecked` of the checkout token from
   * the payer's ATA to the recipient's ATA (creating the recipient ATA when
   * missing), signed by the connected Solana wallet.
   */
  async function handleSolanaPay() {
    if (!session || !solana.address) return;
    const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } =
      await import("@solana/web3.js");

    const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    const deriveAta = (owner: InstanceType<typeof PublicKey>, mintKey: InstanceType<typeof PublicKey>) =>
      PublicKey.findProgramAddressSync(
        [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mintKey.toBuffer()],
        ATA_PROGRAM,
      )[0];

    const mint = new PublicKey(session.acceptedToken);
    const payer = new PublicKey(solana.address);
    const recipient = new PublicKey(session.recipientWallet);
    const payerAta = deriveAta(payer, mint);
    const recipientAta = deriveAta(recipient, mint);

    const rpcUrl = getSolanaRpcUrl(session.chainId);
    if (!rpcUrl) throw new Error("No Solana RPC URL configured for this checkout.");
    const connection = new Connection(rpcUrl, "confirmed");

    const instructions: InstanceType<typeof TransactionInstruction>[] = [];

    // Create the recipient's associated token account if it doesn't exist.
    if (!(await connection.getAccountInfo(recipientAta))) {
      instructions.push(
        new TransactionInstruction({
          programId: ATA_PROGRAM,
          keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: recipientAta, isSigner: false, isWritable: true },
            { pubkey: recipient, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
          ],
          // AssociatedTokenAccountInstruction::CreateIdempotent
          data: new Uint8Array([1]) as unknown as Buffer,
        }),
      );
    }

    // SPL `TransferChecked` (instruction index 12): amount u64 LE + decimals u8.
    const amountAtomic = BigInt(Math.round(Number(session.amount) * 1_000_000));
    const data = new Uint8Array(10);
    data[0] = 12;
    new DataView(data.buffer).setBigUint64(1, amountAtomic, true);
    data[9] = 6;
    instructions.push(
      new TransactionInstruction({
        programId: TOKEN_PROGRAM,
        keys: [
          { pubkey: payerAta, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: recipientAta, isSigner: false, isWritable: true },
          { pubkey: payer, isSigner: true, isWritable: false },
        ],
        data: data as unknown as Buffer,
      }),
    );

    const tx = new Transaction().add(...instructions);
    tx.feePayer = payer;
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;

    const hash = await solana.sendTransaction(tx, rpcUrl);
    setSentTxHash(hash);
    await verifyOnBackend(hash);
  }

  async function handlePay() {
    if (!session) return;
    if (isExpired) {
      setError("This checkout session has expired.");
      return;
    }
    if (isInsufficientBalance) {
      setError(
        `Insufficient ${session.currency} balance. Required: ${session.amount} ${session.currency}, Available: ${(payerBalanceNumber ?? 0).toFixed(4)} ${session.currency}.`,
      );
      return;
    }
    setIsSubmitting(true);
    if (isStellar) {
      if (!stellar.address) {
        setIsSubmitting(false);
        setError("Connect your Stellar wallet before paying.");
        return;
      }
      setError(null);
      setVerificationFailed(false);
      try {
        if (missingCustomerEmail || invalidCustomerEmail) {
          setError("Enter a valid billing email before paying.");
          return;
        }
        if (missingCustomerName) {
          setError("Enter the billing name before paying.");
          return;
        }
        if (isSelfPayment) {
          setError(
            "The connected wallet matches the recipient wallet. Use a different payer wallet or change the payment link recipient.",
          );
          return;
        }
        await persistCustomerDetails();
        await handleStellarPay();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Transaction failed";
        if (!errMsg.includes("User rejected") && !errMsg.includes("User denied") && !errMsg.includes("cancelled")) {
          setError(errMsg);
        }
        setSentTxHash(null);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (isSolana) {
      if (!solana.address) {
        setIsSubmitting(false);
        setError("Connect your Solana wallet before paying.");
        return;
      }
      setError(null);
      setVerificationFailed(false);
      try {
        if (missingCustomerEmail || invalidCustomerEmail) {
          setError("Enter a valid billing email before paying.");
          return;
        }
        if (missingCustomerName) {
          setError("Enter the billing name before paying.");
          return;
        }
        if (isSelfPayment) {
          setError(
            "The connected wallet matches the recipient wallet. Use a different payer wallet or change the payment link recipient.",
          );
          return;
        }
        await persistCustomerDetails();
        await handleSolanaPay();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Transaction failed";
        if (
          !errMsg.includes("User rejected") &&
          !errMsg.includes("User denied") &&
          !errMsg.includes("cancelled")
        ) {
          setError(errMsg);
        }
        setSentTxHash(null);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!address) {
      setIsSubmitting(false);
      return;
    }
    setError(null);
    setVerificationFailed(false);
    try {
      if (missingCustomerEmail || invalidCustomerEmail) {
        setError("Enter a valid billing email before paying.");
        return;
      }

      if (missingCustomerName) {
        setError("Enter the billing name before paying.");
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
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRetry() {
    setError(null);
    setSentTxHash(null);
    setVerificationFailed(false);
    setLoading(true);
    try {
      const createRes = await apiFetch(
        `/api/public/payment-links/${params.slug}/session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerEmail: normalizedCustomerEmail || undefined,
            customerWallet: address ?? customerWallet ?? undefined,
            customerName: normalizedCustomerName || undefined,
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

  const walletConnected = isStellar
    ? stellar.isConnected
    : isSolana
      ? solana.isConnected
      : isConnected;
  const showPay =
    walletConnected &&
    session?.status === "PENDING" &&
    !sentTxHash &&
    !verificationFailed;
  const showProcessing =
    isSubmitting ||
    (Boolean(sentTxHash) &&
      (isConfirming ||
        isSending ||
        verifying ||
        ((isStellar || isSolana) && !verificationFailed)) &&
      session?.status === "PENDING");
  const showError =
    sendError ||
    verificationFailed ||
    (error && session?.status === "PENDING" && !sentTxHash && !verifying);
  const showReceiptError =
    !isStellar &&
    !isSolana &&
    receipt &&
    receipt.status === "reverted" &&
    session?.status === "PENDING";
  const paymentButtonLabel = isSubmitting
    ? "Preparing payment…"
    : isSending
      ? "Confirm in wallet"
      : isConfirming
        ? "Waiting for confirmation"
        : verifying
          ? "Processing payment"
          : isExpired
            ? "Session expired"
            : isInsufficientBalance
              ? `Insufficient ${session?.currency ?? "balance"}`
              : payButtonLabel;

  return (
    <main className="min-h-screen overflow-hidden bg-[#f6f4f1] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {loading && <Skeleton />}

        {/* Error state */}
        {!loading && error && !session && (
          <div className="pt-6 sm:pt-10">
            <div className="mx-auto max-w-3xl overflow-hidden border border-[#e5e7eb] bg-white shadow-[0_20px_60px_-40px_rgba(15,23,42,0.28)]">
              <div className="border-b border-[#eceff4] bg-[#f5f5f7] px-6 py-6 sm:px-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b8f98]">
                  Hosted checkout
                </p>
                <h1 className="mt-3 text-2xl font-semibold text-[#151922]">
                  Checkout unavailable
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#6f7480]">
                  We couldn&apos;t create or restore this checkout session right now.
                </p>
              </div>
              <div className="px-6 py-8 text-center sm:px-8">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-red-200 bg-red-50">
                  <XCircle className="h-7 w-7 text-red-500" />
                </div>
                <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-[#5f6470]">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#111111] px-6 text-sm font-medium text-white transition hover:opacity-95"
                >
                  <RefreshCw className="h-4 w-4" />
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Already PAID */}
        {!loading && session?.status === "PAID" && (
          <div className="pt-6 sm:pt-10">
            <div className="mx-auto max-w-[72rem] overflow-hidden border border-[#e5e7eb] bg-white shadow-[0_20px_60px_-40px_rgba(15,23,42,0.28)] lg:grid lg:grid-cols-[0.95fr_1.05fr]">
              <section className="bg-[#f5f5f7] px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
                <div className="flex items-center gap-3">
                  {merchantLogoUrl ? (
                    <img
                      src={merchantLogoUrl}
                      alt={merchantName}
                      className="h-10 w-10 rounded-full object-cover ring-1 ring-black/5"
                    />
                  ) : (
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
                      style={{
                        backgroundColor: accentColor,
                        color: accentTextColor,
                      }}
                    >
                      {merchantName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-base font-semibold text-[#1f232b]">
                      {merchantName}
                    </p>
                    <p className="text-xs uppercase tracking-[0.18em] text-[#8b8f98]">
                      Payment complete
                    </p>
                  </div>
                </div>
                <div className="mt-8">
                  <p className="text-sm text-[#7a7f89]">Amount paid</p>
                  <p className="mt-2 text-[3rem] font-semibold tracking-[-0.04em] text-[#12161d] sm:text-[3.5rem]">
                    ${amountFormatted}
                  </p>
                </div>
                <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-[#eceff4]">
                  <p className="text-sm font-semibold text-[#1f232b]">
                    Order Summary
                  </p>
                  <div className="mt-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-base font-medium text-[#1f232b]">
                        {displayTitle}
                      </p>
                      <p className="mt-1 text-sm text-[#6f7480]">
                        {billingCadenceLabel}
                      </p>
                    </div>
                    <p className="text-base font-medium text-[#1f232b]">
                      ${amountFormatted}
                    </p>
                  </div>
                </div>
              </section>
              <section className="px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
                <div className="mx-auto max-w-xl text-center lg:pt-8">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#111111] text-white">
                    <CheckCircle2 className="h-8 w-8" />
                  </div>
                  <h1 className="mt-6 text-3xl font-semibold tracking-[-0.03em] text-[#151922]">
                    Payment confirmed
                  </h1>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#6f7480]">
                    Your payment to {recipientDisplayName} has been verified on-chain and this checkout is complete.
                  </p>
                  {session.successUrl ? (
                    <a
                      href={session.successUrl}
                      className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#111111] px-6 text-sm font-medium text-white transition hover:opacity-95"
                    >
                      Continue
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => window.location.assign("/")}
                      className="mt-8 inline-flex h-12 items-center justify-center rounded-lg border border-[#d9dde5] px-6 text-sm font-medium text-[#151922] transition hover:bg-[#f7f8fa]"
                    >
                      Done
                    </button>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* EXPIRED / CANCELLED / FAILED */}
        {!loading &&
          session &&
          (session.status === "EXPIRED" ||
            (isExpired && session.status !== "PAID") ||
            session.status === "CANCELLED" ||
            session.status === "FAILED") && (
            <div className="pt-6 sm:pt-10">
              <div className="mx-auto max-w-3xl overflow-hidden border border-[#e5e7eb] bg-white shadow-[0_20px_60px_-40px_rgba(15,23,42,0.28)]">
                <div className="border-b border-[#eceff4] bg-[#f5f5f7] px-6 py-6 sm:px-8">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b8f98]">
                    Hosted checkout
                  </p>
                  <h1 className="mt-3 text-2xl font-semibold text-[#151922]">
                    {session.status === "EXPIRED" || isExpired
                      ? "Session expired"
                      : session.status === "CANCELLED"
                        ? "Session cancelled"
                        : "Payment failed"}
                  </h1>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-[#6f7480]">
                    {session.status === "EXPIRED" || isExpired
                      ? "This checkout session has ended before payment was completed."
                      : session.status === "CANCELLED"
                        ? "This checkout session is no longer active."
                        : "We couldn&apos;t verify this payment successfully."}
                  </p>
                </div>
                <div className="px-6 py-8 text-center sm:px-8">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#e3e6ed] bg-[#f7f8fa]">
                    <Clock className="h-7 w-7 text-[#3d4048]" />
                  </div>
                  <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-[#5f6470]">
                    {session.status === "FAILED"
                      ? session.verificationError ?? "The payment could not be verified."
                      : session.status === "CANCELLED"
                        ? "Create a fresh session if you still want to complete this payment."
                        : "Create a fresh session to continue this checkout."}
                  </p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#111111] px-6 text-sm font-medium text-white transition hover:opacity-95"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Create new session
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* PENDING — active checkout */}
        {!loading && session?.status === "PENDING" && !isExpired && (
          <div className="pt-6 sm:pt-10">
            <div className="mx-auto max-w-[110rem] overflow-hidden border border-[#e5e7eb] bg-white shadow-[0_20px_60px_-40px_rgba(15,23,42,0.28)] lg:grid lg:grid-cols-[1.02fr_0.98fr]">
              <section className="bg-[#f5f5f7] px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
                <button
                  type="button"
                  onClick={() => {
                    if (session.cancelUrl) {
                      window.location.assign(session.cancelUrl);
                      return;
                    }
                    window.history.back();
                  }}
                  className="inline-flex items-center gap-2 text-sm text-[#8b8f98] transition hover:text-[#3d4048]"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>

                <div className="mt-7 flex items-center gap-3">
                  {merchantLogoUrl ? (
                    <img
                      src={merchantLogoUrl}
                      alt={merchantName}
                      className="h-10 w-10 rounded-full object-cover ring-1 ring-black/5"
                    />
                  ) : (
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
                      style={{
                        backgroundColor: accentColor,
                        color: accentTextColor,
                      }}
                    >
                      {merchantName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-base font-semibold text-[#1f232b]">
                      {merchantName}
                    </p>
                    <p className="text-xs uppercase tracking-[0.18em] text-[#8b8f98]">
                      {paymentLinkKindLabel}
                    </p>
                  </div>
                </div>

                <div className="mt-8">
                  <p className="text-sm text-[#7a7f89]">Pay {merchantName}</p>
                  <p className="mt-2 text-[3rem] font-semibold tracking-[-0.04em] text-[#12161d] sm:text-[3.5rem]">
                    ${amountFormatted}
                  </p>
                </div>

                {isAgentic && (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#e3e5eb] bg-white px-4 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#111318] text-white">
                        <Bot className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-xs text-[#2b313a]">
                        <strong className="font-semibold text-[#12161d]">Agent-Ready Link:</strong> Machine-readable checkout supporting autonomous AI agents via x402 &amp; MCP.
                      </span>
                    </div>
                    <span className="hidden sm:inline-flex rounded-md border border-[#e3e5eb] bg-[#f7f8fa] px-2 py-0.5 text-[10px] font-medium tracking-wide text-[#5f6470]">
                      x402 / MCP
                    </span>
                  </div>
                )}

                <div className="mt-10">
                  <p className="text-xl font-semibold text-[#1f232b]">
                    Order Summary
                  </p>

                  <div className="mt-5 flex items-start gap-4">
                    <div
                      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold"
                      style={{
                        backgroundColor: accentColor,
                        color: accentTextColor,
                      }}
                    >
                      {displayTitle
                        .split(" ")
                        .slice(0, 2)
                        .map((part) => part.charAt(0))
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-lg font-medium text-[#1f232b]">
                            {displayTitle}
                          </p>
                          <p className="mt-1 text-sm text-[#5f6470]">
                            {billingCadenceLabel}
                          </p>
                          <p className="mt-2 max-w-md text-sm leading-6 text-[#7a7f89]">
                            {displayDescription}
                          </p>
                        </div>
                        <p className="whitespace-nowrap text-base font-medium text-[#1f232b]">
                          ${amountFormatted}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 space-y-3 border-t border-[#d8dbe2] pt-5 text-sm">
                    <div className="flex items-center justify-between text-[#2b313a]">
                      <span>Subtotal</span>
                      <span>${amountFormatted}</span>
                    </div>
                    <div className="flex items-center justify-between text-[#7a7f89]">
                      <span>Tax</span>
                      <span>$0.00</span>
                    </div>
                    <div className="flex items-center justify-between text-[#7a7f89]">
                      <span>Shipping</span>
                      <span>Free</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-[#d8dbe2] pt-4 text-base font-semibold text-[#161a22]">
                      <span>Total</span>
                      <span>${amountFormatted}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-3 text-xs text-[#6f7480]">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 ring-1 ring-[#e3e5eb]">
                    <Web3Icon token={session.currency} size="sm" />
                    <span>{session.currency}</span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 ring-1 ring-[#e3e5eb]">
                    <Web3Icon chainLabel={checkoutChainLabel} size="sm" />
                    <span>{checkoutChainLabel}</span>
                  </div>
                  {countdown ? (
                    <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 ring-1 ring-[#e3e5eb]">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{countdown} left</span>
                    </div>
                  ) : null}
                </div>

                {isAgentic && (
                  <AgenticPaymentLinkPanel
                    slug={params.slug as string}
                    amount={amountFormatted}
                    currency={session.currency}
                    chainId={session.chainId}
                    origin={typeof window !== "undefined" ? window.location.origin : ""}
                  />
                )}
              </section>

              <section className="px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
                <button
                  type="button"
                  onClick={() => {
                    if (isStellar) {
                      if (!stellar.isConnected) {
                        void stellar.connect();
                        return;
                      }
                      if (showPay && !isInsufficientBalance && !isExpired) {
                        void handlePay();
                      }
                      return;
                    }
                    if (isSolana) {
                      if (!solana.isConnected) {
                        void solana.connect();
                        return;
                      }
                      if (showPay && !isInsufficientBalance && !isExpired) {
                        void handlePay();
                      }
                      return;
                    }
                    if (!isConnected) {
                      open();
                      return;
                    }
                    if (showPay && !isInsufficientBalance && !isExpired) {
                      void handlePay();
                    }
                  }}
                  disabled={showProcessing || isSending || isSubmitting || stellar.isLoading || solana.isLoading || isExpired || (walletConnected && isInsufficientBalance)}
                  className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-lg px-5 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    backgroundColor: accentColor,
                    color: accentTextColor,
                  }}
                >
                  {isSubmitting || showProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {paymentButtonLabel}
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      {isStellar
                        ? stellar.isConnected
                          ? isInsufficientBalance
                            ? `Insufficient ${session.currency}`
                            : "Pay with wallet"
                          : "Connect Stellar wallet to pay"
                        : isSolana
                          ? solana.isConnected
                            ? isInsufficientBalance
                              ? `Insufficient ${session.currency}`
                              : "Pay with wallet"
                            : "Connect Solana wallet to pay"
                          : isConnected
                            ? isInsufficientBalance
                              ? `Insufficient ${session.currency}`
                              : "Pay with wallet"
                            : "Connect wallet to pay"}
                    </>
                  )}
                </button>

                <div className="my-7 flex items-center gap-4 text-sm text-[#b2b6bf]">
                  <div className="h-px flex-1 bg-[#e7e9ef]" />
                  <span>Or</span>
                  <div className="h-px flex-1 bg-[#e7e9ef]" />
                </div>

                <div className="space-y-6">
                  <div>
                    <p className="text-[15px] font-semibold text-[#1e222b]">
                      Contact info
                    </p>
                    <label className="mt-3 block space-y-2">
                      <span className="text-sm text-[#373b44]">Email</span>
                      <input
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        className="h-12 w-full rounded-xl border border-[#dfe3ea] bg-white px-4 text-sm text-[#1d2129] outline-none transition focus:border-[#111827]"
                        placeholder="you@example.com"
                      />
                    </label>
                    <p
                      className={
                        missingCustomerEmail || invalidCustomerEmail
                          ? "mt-2 text-xs text-red-600"
                          : "mt-2 text-xs text-[#81848f]"
                      }
                    >
                      {missingCustomerEmail || invalidCustomerEmail
                        ? "Enter a valid billing email so we can send the invoice and receipt."
                        : "Receipts and invoices will go to this address."}
                    </p>
                  </div>

                  <div>
                    <p className="text-[15px] font-semibold text-[#1e222b]">
                      Payment method
                    </p>
                    <div className="mt-3 rounded-xl border border-[#dfe3ea] bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-10 w-10 items-center justify-center rounded-full"
                            style={{ backgroundColor: accentSoftColor }}
                          >
                            <Web3Icon token={session.currency} size="md" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[#1f232b]">
                              {isStellar
                                ? "Stellar wallet transfer"
                                : isSolana
                                  ? "Solana wallet transfer"
                                  : "Wallet transfer"}
                            </p>
                            <p className="text-xs text-[#7a7f89]">
                              Send {session.currency} to {recipientDisplayName}
                            </p>
                          </div>
                        </div>
                        <div className="text-right text-xs text-[#6f7480]">
                          <p>{session.currency}</p>
                          <p>{checkoutChainLabel}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-[15px] font-semibold text-[#1e222b]">
                      Billing information
                    </p>
                    <div className="mt-3 space-y-3">
                      <label className="block space-y-2">
                        <span className="text-sm text-[#373b44]">Full name</span>
                        <input
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          className="h-12 w-full rounded-xl border border-[#dfe3ea] bg-white px-4 text-sm text-[#1d2129] outline-none transition focus:border-[#111827]"
                          placeholder="Ada Lovelace"
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="text-sm text-[#373b44]">
                          Country or region
                        </span>
                        <div className="relative">
                          <select
                            value={billingCountry}
                            onChange={(e) => setBillingCountry(e.target.value)}
                            className="h-12 w-full appearance-none rounded-xl border border-[#dfe3ea] bg-white px-4 text-sm text-[#1d2129] outline-none transition focus:border-[#111827]"
                          >
                            <option value="">Select your country</option>
                            <option>India</option>
                            <option>United States</option>
                            <option>United Kingdom</option>
                            <option>United Arab Emirates</option>
                            <option>Singapore</option>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9497a1]" />
                        </div>
                      </label>
                      <label className="block space-y-2">
                        <span className="text-sm text-[#373b44]">
                          Address line 1
                        </span>
                        <input
                          value={addressLine1}
                          onChange={(e) => setAddressLine1(e.target.value)}
                          className="h-12 w-full rounded-xl border border-[#dfe3ea] bg-white px-4 text-sm text-[#1d2129] outline-none transition focus:border-[#111827]"
                          placeholder="Street address"
                        />
                      </label>
                    </div>
                    <p
                      className={
                        missingCustomerName
                          ? "mt-2 text-xs text-red-600"
                          : "mt-2 text-xs text-[#81848f]"
                      }
                    >
                      {missingCustomerName
                        ? "Enter the billing name that should appear on the invoice and receipt."
                        : "We use this for hosted receipts and customer support context."}
                    </p>
                  </div>

                  {isStellar ? (
                    stellar.isConnected ? (
                      <div className="rounded-xl border border-[#dfe3ea] bg-[#fafbfc] px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#1f232b]">
                              Connected Stellar wallet
                            </p>
                            <p className="mt-1 break-all font-mono text-xs text-[#70737d]">
                              {stellar.address}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void stellar.connect()}
                            className="shrink-0 text-xs font-medium text-[#111827] hover:text-black"
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    ) : null
                  ) : isSolana ? (
                    solana.isConnected ? (
                      <div className="rounded-xl border border-[#dfe3ea] bg-[#fafbfc] px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#1f232b]">
                              Connected Solana wallet
                            </p>
                            <p className="mt-1 break-all font-mono text-xs text-[#70737d]">
                              {solana.address}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void solana.connect()}
                            className="shrink-0 text-xs font-medium text-[#111827] hover:text-black"
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    ) : null
                  ) : isConnected ? (
                    <div className="rounded-xl border border-[#dfe3ea] bg-[#fafbfc] px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#1f232b]">
                            Connected wallet
                          </p>
                          <p className="mt-1 break-all font-mono text-xs text-[#70737d]">
                            {address}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => open()}
                          className="shrink-0 text-xs font-medium text-[#111827] hover:text-black"
                        >
                          Change
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {!isStellar && !isSolana && !isCorrectNetwork ? (
                    <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-3 text-sm text-warning">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-3">
                          <p>
                            This checkout is for {checkoutChainLabel}. Switch
                            networks before paying.
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              void switchChainAsync({ chainId: session.chainId })
                            }
                            disabled={isSwitchingNetwork}
                            className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-medium text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:opacity-60"
                          >
                            {isSwitchingNetwork ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Switching…
                              </>
                            ) : (
                              <>Switch to {checkoutChainLabel}</>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {isSelfPayment ? (
                    <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-3 text-sm text-warning">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                          The payer wallet matches the recipient wallet. Use a
                          different payer wallet or update the payment link
                          recipient.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {walletConnected && isInsufficientBalance ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                        <div>
                          <p className="font-semibold text-red-900">
                            Insufficient {session.currency} balance
                          </p>
                          <p className="mt-1 text-xs text-red-700">
                            Required: {session.amount} {session.currency}. Your balance: {(payerBalanceNumber ?? 0).toFixed(4)} {session.currency}.
                            Please fund your wallet with {session.currency} before completing this payment.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void handlePay()}
                    disabled={!showPay || !canSubmitPayment || isSubmitting || isInsufficientBalance || isExpired}
                    className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-lg bg-[#111111] px-5 text-base font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {showProcessing || isSending || isSubmitting ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        {paymentButtonLabel}
                      </>
                    ) : (
                      <>{paymentButtonLabel}</>
                    )}
                  </button>

                  {showReceiptError && !isConfirming && !verifying ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          Transaction reverted on-chain. Please try again.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSentTxHash(null);
                          setVerificationFailed(false);
                        }}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-50"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Try again
                      </button>
                    </div>
                  ) : null}

                  {verificationFailed && !verifying && sentTxHash ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          {error ??
                            "Verification failed. The transaction may still be confirming. You can retry."}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setVerificationFailed(false);
                          void verifyOnBackend(sentTxHash);
                        }}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-100 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-200"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Retry verification
                      </button>
                    </div>
                  ) : null}

                  {showError &&
                  !isSending &&
                  !isConfirming &&
                  !verifying &&
                  !verificationFailed ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          {sendError
                            ? ((sendError as { shortMessage?: string })
                                .shortMessage ??
                              (sendError as Error).message)
                            : error || "Transaction failed"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setSentTxHash(null);
                        }}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-50"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Try again
                      </button>
                    </div>
                  ) : null}

                  <div className="pt-4 text-center text-xs text-[#8b8f98]">
                    <p>Powered by ArcenPay</p>
                    <div className="mt-2 flex items-center justify-center gap-4">
                      <span className="inline-flex items-center gap-1.5">
                        <Shield className="h-3.5 w-3.5" />
                        Secure checkout
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5" />
                        {checkoutChainLabel}
                      </span>
                      {billingCountry ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPinHouse className="h-3.5 w-3.5" />
                          {billingCountry}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
