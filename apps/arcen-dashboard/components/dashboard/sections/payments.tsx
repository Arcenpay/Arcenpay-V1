"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  Copy,
  CreditCard,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getUsdcAddress } from "@/lib/contracts";
import { toast } from "sonner";

type PaymentLinkRow = {
  id: string;
  name: string;
  slug: string;
  kind: "ADDON" | "INVOICE" | "CUSTOM";
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  amount: string;
  currency: string;
  recipientWallet: string;
  checkoutUrl: string;
  checkoutSessions?: Array<{
    id: string;
    status: string;
    txHash?: string | null;
    paidAt?: string | null;
  }>;
};

type CheckoutSessionRow = {
  id: string;
  purpose: "ADDON" | "INVOICE" | "CUSTOM";
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED" | "FAILED";
  customerEmail?: string | null;
  customerWallet?: string | null;
  amount: string;
  currency: string;
  txHash?: string | null;
  createdAt: string;
  paidAt?: string | null;
  paymentLink?: { id: string; name: string; slug: string; kind: string } | null;
  company?: { id: string; name: string } | null;
};

const BASE_SEPOLIA_USDC = getUsdcAddress(84532);

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <Copy className="h-3.5 w-3.5" />
      {copied ? "Copied" : label}
    </Button>
  );
}

export function PaymentsSection() {
  const { address } = useAccount();
  const [paymentLinks, setPaymentLinks] = useState<PaymentLinkRow[]>([]);
  const [checkoutSessions, setCheckoutSessions] = useState<CheckoutSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    amount: "",
    recipientWallet: address ?? "",
    successUrl: "",
    cancelUrl: "",
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [linksRes, sessionsRes] = await Promise.all([
        fetch("/api/v1/payment-links", { cache: "no-store" }),
        fetch("/api/v1/checkout-sessions", { cache: "no-store" }),
      ]);

      const linksPayload = (await linksRes.json()) as {
        paymentLinks?: PaymentLinkRow[];
      };
      const sessionsPayload = (await sessionsRes.json()) as {
        checkoutSessions?: CheckoutSessionRow[];
      };
      setPaymentLinks(
        Array.isArray(linksPayload.paymentLinks) ? linksPayload.paymentLinks : [],
      );
      setCheckoutSessions(
        Array.isArray(sessionsPayload.checkoutSessions)
          ? sessionsPayload.checkoutSessions
          : [],
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (address) {
      setForm((current) =>
        current.recipientWallet ? current : { ...current, recipientWallet: address },
      );
    }
  }, [address]);

  async function createCustomPaymentLink() {
    if (!form.name.trim() || !form.amount.trim() || !form.recipientWallet.trim()) {
      toast.error("Name, amount, and recipient wallet are required.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/v1/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "CUSTOM",
          name: form.name,
          amount: Number(form.amount),
          acceptedToken: BASE_SEPOLIA_USDC,
          recipientWallet: form.recipientWallet,
          successUrl: form.successUrl || undefined,
          cancelUrl: form.cancelUrl || undefined,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || "Unable to create payment link.");
      }
      toast.success("Payment link created");
      setForm((current) => ({
        ...current,
        name: "",
        amount: "",
        successUrl: "",
        cancelUrl: "",
      }));
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create payment link",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create hosted one-time payment links, monitor sessions, and verify Base Sepolia checkout activity.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4">
            <p className="text-sm font-semibold text-foreground">Create custom payment link</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Gateway-style one-time USDC collection on Base Sepolia.
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Link name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                placeholder="Priority setup fee"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Amount (USDC)</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value }))}
                  placeholder="49.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Accepted token</Label>
                <Input value={BASE_SEPOLIA_USDC} disabled className="font-mono text-xs" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Recipient wallet</Label>
              <div className="relative">
                <Wallet className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={form.recipientWallet}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      recipientWallet: e.target.value,
                    }))
                  }
                  placeholder="0x..."
                  className="pl-10 font-mono text-xs"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Success URL</Label>
                <Input
                  value={form.successUrl}
                  onChange={(e) => setForm((current) => ({ ...current, successUrl: e.target.value }))}
                  placeholder="https://app.yoursite.com/paid"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cancel URL</Label>
                <Input
                  value={form.cancelUrl}
                  onChange={(e) => setForm((current) => ({ ...current, cancelUrl: e.target.value }))}
                  placeholder="https://app.yoursite.com/cancelled"
                />
              </div>
            </div>
            <Button onClick={() => void createCustomPaymentLink()} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" />
                  Create payment link
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Payment links</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add-on, invoice, and custom hosted checkout links.
              </p>
            </div>
            <Badge variant="outline">{paymentLinks.length}</Badge>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading payment links…
            </div>
          ) : paymentLinks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-10 text-center">
              <CreditCard className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium text-foreground">No payment links yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create a custom link here, or generate one directly from a one-time add-on.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {paymentLinks.map((link) => (
                <div
                  key={link.id}
                  className="rounded-2xl border border-border bg-secondary/20 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{link.name}</p>
                        <Badge variant="outline">{link.kind.toLowerCase()}</Badge>
                        <Badge variant={link.status === "ACTIVE" ? "secondary" : "outline"}>
                          {link.status.toLowerCase()}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {Number(link.amount).toFixed(2)} {link.currency} to{" "}
                        <span className="font-mono">
                          {link.recipientWallet.slice(0, 8)}…{link.recipientWallet.slice(-6)}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyButton value={link.checkoutUrl} label="Copy link" />
                      <Button asChild variant="outline" size="sm">
                        <a href={link.checkoutUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-2 h-3.5 w-3.5" />
                          Open
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Recent checkout sessions</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Real hosted payment activity and verification status.
            </p>
          </div>
          <Badge variant="outline">{checkoutSessions.length}</Badge>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Loading checkout sessions…
          </div>
        ) : checkoutSessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-10 text-center text-sm text-muted-foreground">
            Sessions will appear here once a customer opens a hosted checkout link.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2.5 pr-4">Session</th>
                  <th className="py-2.5 pr-4">Customer</th>
                  <th className="py-2.5 pr-4">Amount</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-0">Created</th>
                </tr>
              </thead>
              <tbody>
                {checkoutSessions.map((session) => (
                  <tr key={session.id} className="border-b border-border/40">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-foreground">
                        {session.paymentLink?.name || session.purpose}
                      </div>
                      <div className="text-xs text-muted-foreground">{session.id}</div>
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground">
                      {session.company?.name ||
                        session.customerEmail ||
                        session.customerWallet ||
                        "Unknown"}
                    </td>
                    <td className="py-3 pr-4 text-foreground">
                      {Number(session.amount).toFixed(2)} {session.currency}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge
                        variant={session.status === "PAID" ? "secondary" : "outline"}
                      >
                        {session.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="py-3 pr-0 text-xs text-muted-foreground">
                      {new Date(session.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
