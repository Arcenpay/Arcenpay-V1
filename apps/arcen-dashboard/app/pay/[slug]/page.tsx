"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Copy, Loader2, Wallet, AlertTriangle } from "lucide-react";

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
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      {copied ? "Copied" : "Copy"}
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

export default function HostedPaymentPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [session, setSession] = useState<PublicCheckoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerWallet, setCustomerWallet] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [txHash, setTxHash] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
          if (!res.ok) throw new Error("Hosted checkout session not found.");
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
          throw new Error(payload.error || "Unable to create hosted checkout session.");
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
    return () => {
      cancelled = true;
    };
  }, [params.slug, router, searchParams]);

  async function handleConfirm() {
    if (!session || !txHash.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/checkout/${session.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: txHash.trim(),
          senderWallet: customerWallet || undefined,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        checkoutSession?: PublicCheckoutSession;
      };
      if (!res.ok || !payload.checkoutSession) {
        throw new Error(payload.error || "Unable to verify payment.");
      }
      setSession(payload.checkoutSession);
      if (payload.checkoutSession.successUrl) {
        window.location.assign(payload.checkoutSession.successUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify payment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe,transparent_38%),linear-gradient(180deg,#f8fafc,#eef2ff)] px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">
            ArcenPay Hosted Checkout
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
            {session?.paymentLink?.name ?? "Hosted payment"}
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Base Sepolia one-time USDC checkout. Send the exact amount below, then verify the transaction.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-[0_20px_80px_-40px_rgba(15,23,42,0.35)] backdrop-blur">
            {loading ? (
              <div className="flex min-h-[320px] items-center justify-center text-slate-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Preparing checkout…
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {error}
              </div>
            ) : session?.status === "PAID" ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                <CheckCircle2 className="h-14 w-14 text-emerald-500" />
                <h2 className="mt-4 text-2xl font-semibold text-slate-950">
                  Payment verified
                </h2>
                <p className="mt-2 max-w-md text-sm text-slate-600">
                  Your transaction has been confirmed and applied to this checkout session.
                </p>
                {session.txHash ? (
                  <p className="mt-4 text-xs font-mono text-slate-500">
                    {session.txHash}
                  </p>
                ) : null}
              </div>
            ) : session ? (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                    Payment summary
                  </p>
                  <div className="mt-3 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-3xl font-semibold text-slate-950">
                        {Number(session.amount).toFixed(2)} {session.currency}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {session.catalogAddOn?.name ||
                          session.invoice?.number ||
                          "One-time hosted payment"}
                      </p>
                    </div>
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800">
                      Base Sepolia
                    </span>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1 text-sm text-slate-700">
                    <span>Email</span>
                    <input
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none ring-0 transition focus:border-slate-400"
                      placeholder="buyer@company.com"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-slate-700">
                    <span>Name</span>
                    <input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none ring-0 transition focus:border-slate-400"
                      placeholder="Acme Team"
                    />
                  </label>
                </div>

                <label className="space-y-1 text-sm text-slate-700">
                  <span>Paying wallet</span>
                  <div className="relative">
                    <Wallet className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={customerWallet}
                      onChange={(e) => setCustomerWallet(e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 font-mono text-sm outline-none transition focus:border-slate-400"
                      placeholder="0x..."
                    />
                  </div>
                </label>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-900">Send an exact USDC transfer</p>
                  <div className="mt-4 space-y-4 text-sm">
                    <div>
                      <div className="mb-1 flex items-center justify-between text-slate-500">
                        <span>Recipient wallet</span>
                        <CopyField value={session.recipientWallet} />
                      </div>
                      <p className="break-all rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900">
                        {session.recipientWallet}
                      </p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-slate-500">
                        <span>USDC token</span>
                        <CopyField value={session.acceptedToken} />
                      </div>
                      <p className="break-all rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900">
                        {session.acceptedToken}
                      </p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-slate-500">
                        <span>Exact amount</span>
                        <CopyField value={String(Number(session.amount).toFixed(6))} />
                      </div>
                      <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900">
                        {Number(session.amount).toFixed(6)} {session.currency}
                      </p>
                    </div>
                  </div>
                </div>

                <label className="space-y-1 text-sm text-slate-700">
                  <span>Transaction hash</span>
                  <input
                    value={txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-slate-400"
                    placeholder="0x..."
                  />
                </label>

                {session.verificationError ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {session.verificationError}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={submitting || !txHash.trim()}
                  className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying payment…
                    </>
                  ) : (
                    "Verify payment"
                  )}
                </button>
              </div>
            ) : null}
          </section>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_20px_80px_-40px_rgba(15,23,42,0.35)] backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                What happens next
              </p>
              <ol className="mt-4 space-y-3 text-sm text-slate-700">
                <li>1. Transfer the exact USDC amount on Base Sepolia.</li>
                <li>2. Paste the transaction hash back into this page.</li>
                <li>3. ArcenPay verifies the transfer on-chain and marks the checkout as paid.</li>
                <li>4. Invoice and add-on access are applied automatically when relevant.</li>
              </ol>
            </div>

            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Exact-match verification</p>
                  <p className="mt-1 text-amber-900/80">
                    The backend only accepts a direct Base Sepolia USDC transfer to the exact recipient and amount shown here.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
