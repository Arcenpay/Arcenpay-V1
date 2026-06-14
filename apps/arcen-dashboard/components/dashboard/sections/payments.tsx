"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import {
  Copy,
  CreditCard,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  Wallet,
  Check,
  X,
  Trash2,
  Clock,
  ArrowUpRight,
  DollarSign,
  Users,
  Link2Off,
  Settings2,
  Info,
  Palette,
  ChevronDown,
  ChevronUp,
  ImageOff,
  AlertCircle,
  ShieldCheck,
  Globe,
  Paintbrush,
} from "lucide-react";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { getUsdcAddress } from "@/lib/contracts";
import { getChainLabel, resolveEnvironmentChainId } from "@/lib/default-chain";
import { readJsonOrThrow } from "@/lib/http-json";
import {
  mergePaymentLinkCheckoutAppearance,
  readPaymentLinkCheckoutAppearance,
} from "@/lib/payment-link-checkout";
import { toast } from "sonner";
import { useEnvironment } from "@/contexts/environment-context";

type CompanyOption = {
  id: string;
  name: string;
  walletAddress: string | null;
  email: string | null;
};

type PaymentLinkRow = {
  id: string;
  name: string;
  slug: string;
  kind: "ADDON" | "INVOICE" | "CUSTOM";
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  amount: string;
  currency: string;
  recipientWallet: string;
  acceptedToken: string;
  chainId: number;
  checkoutUrl: string;
  expiresAt?: string | null;
  createdAt: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  successUrl?: string | null;
  cancelUrl?: string | null;
  company?: {
    id: string;
    name: string;
    email: string | null;
    walletAddress: string | null;
    logoUrl?: string | null;
  } | null;
  catalogAddOn?: { id: string; name: string; code: string; billingType: string; saleMode: string } | null;
  invoice?: { id: string; number: string; status: string; total: string; currency: string } | null;
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
  customerName?: string | null;
  amount: string;
  currency: string;
  txHash?: string | null;
  verificationError?: string | null;
  createdAt: string;
  paidAt?: string | null;
  paymentLink?: { id: string; name: string; slug: string; kind: string } | null;
  company?: { id: string; name: string; email: string | null; walletAddress: string | null } | null;
  payment?: { id: string; status: string; txHash: string; amount: string; currency: string } | null;
};

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

function statusVariant(status: string) {
  switch (status) {
    case "ACTIVE":
    case "PAID":
      return "secondary" as const;
    case "INACTIVE":
    case "PENDING":
      return "outline" as const;
    case "ARCHIVED":
    case "EXPIRED":
    case "CANCELLED":
      return "outline" as const;
    case "FAILED":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

const LINK_KIND_LABELS: Record<string, string> = {
  ADDON: "Add-on",
  INVOICE: "Invoice",
  CUSTOM: "Custom",
};

const PRESET_COLORS = [
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#ca8a04",
  "#0891b2",
  "#059669",
  "#4f46e5",
  "#be123c",
  "#9333ea",
  "#1e293b",
];

function generateIdempotencyKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-secondary/20 transition-colors rounded-t-xl"
      >
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-4">{children}</div>}
    </div>
  );
}

export function PaymentsSection() {
  const { address } = useAccount();
  const { envMode, activeEnvironment } = useEnvironment();
  const configuredChainId = activeEnvironment?.chainId ?? resolveEnvironmentChainId(envMode);
  const environmentKey = activeEnvironment?.id ?? envMode;
  const runtimeUsdc = getUsdcAddress(configuredChainId);
  const runtimeChainLabel = getChainLabel(configuredChainId);
  const [paymentLinks, setPaymentLinks] = useState<PaymentLinkRow[]>([]);
  const [checkoutSessions, setCheckoutSessions] = useState<CheckoutSessionRow[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    name: "",
    amount: "",
    recipientWallet: address ?? "",
    successUrl: "",
    cancelUrl: "",
    description: "",
    companyId: "",
    checkoutTitle: "",
    checkoutDescription: "",
    brandName: "",
    recipientName: "",
    buttonLabel: "",
    accentColor: "",
    logoUrl: "",
  });

  const [editDialog, setEditDialog] = useState<PaymentLinkRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    recipientWallet: "",
    successUrl: "",
    cancelUrl: "",
    description: "",
    expiresAt: "",
    checkoutTitle: "",
    checkoutDescription: "",
    brandName: "",
    recipientName: "",
    buttonLabel: "",
    accentColor: "",
    logoUrl: "",
  });

  const logoPreviewRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoPreviewError, setLogoPreviewError] = useState(false);
  const editLogoPreviewRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editLogoPreview, setEditLogoPreview] = useState<string | null>(null);
  const [editLogoPreviewError, setEditLogoPreviewError] = useState(false);

  useEffect(() => {
    if (logoPreviewRef.current) clearTimeout(logoPreviewRef.current);
    if (!form.logoUrl) {
      setLogoPreview(null);
      setLogoPreviewError(false);
      return;
    }
    logoPreviewRef.current = setTimeout(() => {
      const img = new Image();
      img.onload = () => {
        setLogoPreview(form.logoUrl);
        setLogoPreviewError(false);
      };
      img.onerror = () => {
        setLogoPreview(null);
        setLogoPreviewError(true);
      };
      img.src = form.logoUrl;
    }, 400);
    return () => {
      if (logoPreviewRef.current) clearTimeout(logoPreviewRef.current);
    };
  }, [form.logoUrl]);

  useEffect(() => {
    if (editLogoPreviewRef.current) clearTimeout(editLogoPreviewRef.current);
    if (!editForm.logoUrl) {
      setEditLogoPreview(null);
      setEditLogoPreviewError(false);
      return;
    }
    editLogoPreviewRef.current = setTimeout(() => {
      const img = new Image();
      img.onload = () => {
        setEditLogoPreview(editForm.logoUrl);
        setEditLogoPreviewError(false);
      };
      img.onerror = () => {
        setEditLogoPreview(null);
        setEditLogoPreviewError(true);
      };
      img.src = editForm.logoUrl;
    }, 400);
    return () => {
      if (editLogoPreviewRef.current) clearTimeout(editLogoPreviewRef.current);
    };
  }, [editForm.logoUrl]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [linksRes, sessionsRes, companiesRes] = await Promise.all([
        fetch("/api/v1/payment-links", { cache: "no-store" }),
        fetch("/api/v1/checkout-sessions", { cache: "no-store" }),
        fetch("/api/v1/companies?limit=100", { cache: "no-store" }),
      ]);

      const [linksPayload, sessionsPayload, companiesPayload] = await Promise.all([
        readJsonOrThrow<{ paymentLinks?: PaymentLinkRow[] }>(
          linksRes,
          "Failed to load payment links",
        ),
        readJsonOrThrow<{ checkoutSessions?: CheckoutSessionRow[] }>(
          sessionsRes,
          "Failed to load checkout sessions",
        ),
        readJsonOrThrow<{ data?: CompanyOption[] }>(
          companiesRes,
          "Failed to load companies",
        ),
      ]);

      setPaymentLinks(
        Array.isArray(linksPayload.paymentLinks) ? linksPayload.paymentLinks : [],
      );
      setCheckoutSessions(
        Array.isArray(sessionsPayload.checkoutSessions) ? sessionsPayload.checkoutSessions : [],
      );
      setCompanies(
        Array.isArray(companiesPayload.data)
          ? companiesPayload.data.filter((c) => c.walletAddress)
          : [],
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load payments",
      );
    } finally {
      setLoading(false);
    }
  }, [environmentKey]);

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
          idempotencyKey: generateIdempotencyKey(),
          kind: "CUSTOM",
          name: form.name,
          description: form.description || undefined,
          metadata: mergePaymentLinkCheckoutAppearance(undefined, {
            title: form.checkoutTitle,
            description: form.checkoutDescription,
            brandName: form.brandName,
            recipientName: form.recipientName,
            buttonLabel: form.buttonLabel,
            accentColor: form.accentColor,
            logoUrl: form.logoUrl,
          }),
          amount: Number(form.amount),
          acceptedToken: runtimeUsdc,
          recipientWallet: form.recipientWallet,
          companyId: form.companyId || undefined,
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
      setForm({
        name: "",
        amount: "",
        recipientWallet: address ?? "",
        successUrl: "",
        cancelUrl: "",
        description: "",
        companyId: "",
        checkoutTitle: "",
        checkoutDescription: "",
        brandName: "",
        recipientName: "",
        buttonLabel: "",
        accentColor: "",
        logoUrl: "",
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create payment link");
    } finally {
      setCreating(false);
    }
  }

  async function toggleLinkStatus(link: PaymentLinkRow) {
    const newStatus = link.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      const res = await fetch(`/api/v1/payment-links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || "Failed to update");
      }
      toast.success(newStatus === "ACTIVE" ? "Link activated" : "Link deactivated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update link");
    }
  }

  async function archiveLink(link: PaymentLinkRow) {
    try {
      const res = await fetch(`/api/v1/payment-links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || "Failed to archive");
      }
      toast.success("Payment link archived");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to archive link");
    }
  }

  async function saveEdit() {
    if (!editDialog) return;
    if (!editForm.name.trim() || !editForm.recipientWallet.trim()) {
      toast.error("Name and recipient wallet are required.");
      return;
    }
    try {
      const res = await fetch(`/api/v1/payment-links/${editDialog.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: generateIdempotencyKey(),
          name: editForm.name,
          description: editForm.description || null,
          metadata: mergePaymentLinkCheckoutAppearance(editDialog.metadata, {
            title: editForm.checkoutTitle,
            description: editForm.checkoutDescription,
            brandName: editForm.brandName,
            recipientName: editForm.recipientName,
            buttonLabel: editForm.buttonLabel,
            accentColor: editForm.accentColor,
            logoUrl: editForm.logoUrl,
          }) ?? null,
          recipientWallet: editForm.recipientWallet,
          successUrl: editForm.successUrl || null,
          cancelUrl: editForm.cancelUrl || null,
          expiresAt: editForm.expiresAt || null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || "Failed to save");
      }
      toast.success("Payment link updated");
      setEditDialog(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update link");
    }
  }

  function openEdit(link: PaymentLinkRow) {
    const appearance = readPaymentLinkCheckoutAppearance(link.metadata);
    setEditDialog(link);
    setEditForm({
      name: link.name,
      recipientWallet: link.recipientWallet,
      successUrl: link.successUrl ?? "",
      cancelUrl: link.cancelUrl ?? "",
      description: link.description ?? "",
      expiresAt: link.expiresAt ? new Date(link.expiresAt).toISOString().slice(0, 16) : "",
      checkoutTitle: appearance.title,
      checkoutDescription: appearance.description,
      brandName: appearance.brandName,
      recipientName: appearance.recipientName,
      buttonLabel: appearance.buttonLabel,
      accentColor: appearance.accentColor,
      logoUrl: appearance.logoUrl,
    });
  }

  function selectCompany(companyId: string) {
    setForm((current) => ({ ...current, companyId }));
  }

  const activeLinks = paymentLinks.filter((l) => l.status === "ACTIVE");
  const totalRevenue = checkoutSessions
    .filter((s) => s.status === "PAID")
    .reduce((sum, s) => sum + Number(s.amount), 0);
  const pendingSessions = checkoutSessions.filter((s) => s.status === "PENDING").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create hosted one-time payment links, monitor sessions, and verify {runtimeChainLabel} checkout activity.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <Link2 className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{activeLinks.length}</p>
              <p className="text-xs text-muted-foreground">Active links</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <DollarSign className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold">
                ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground">Total revenue</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <Clock className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{pendingSessions}</p>
              <p className="text-xs text-muted-foreground">Pending sessions</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <Users className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{checkoutSessions.length}</p>
              <p className="text-xs text-muted-foreground">Total sessions</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {/* Create payment link */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4">
            <p className="text-sm font-semibold text-foreground">Create payment link</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Custom USDC collection link on {runtimeChainLabel}. Shareable and reusable.
            </p>
          </div>
          <div className="space-y-4">
            <CollapsibleSection title="Required" icon={Info} defaultOpen={true}>
              <div className="space-y-1.5">
                <Label>Link name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                  placeholder="Priority setup fee"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
                  placeholder="One-time setup fee for premium tier"
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
                    onChange={(e) => setForm((c) => ({ ...c, amount: e.target.value }))}
                    placeholder="49.00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Accepted token</Label>
                  <Input value="USDC" disabled className="font-mono text-xs" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Recipient wallet</Label>
                <div className="relative">
                  <Wallet className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={form.recipientWallet}
                    onChange={(e) =>
                      setForm((c) => ({
                        ...c,
                        recipientWallet: e.target.value,
                      }))
                    }
                    placeholder="0x..."
                    className="pl-10 font-mono text-xs"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  This is the wallet that receives the USDC payment.
                </p>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Redirect URLs" icon={Globe} defaultOpen={true}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Success URL (optional)</Label>
                  <div className="relative">
                    <Input
                      value={form.successUrl}
                      onChange={(e) => setForm((c) => ({ ...c, successUrl: e.target.value }))}
                      placeholder="https://app.yoursite.com/paid"
                      className={
                        form.successUrl && !/^https?:\/\/.+/.test(form.successUrl)
                          ? "border-red-500 pr-8"
                          : form.successUrl
                            ? "border-green-500 pr-8"
                            : ""
                      }
                    />
                    {form.successUrl && /^https?:\/\/.+/.test(form.successUrl) && (
                      <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground" />
                    )}
                    {form.successUrl && !/^https?:\/\/.+/.test(form.successUrl) && (
                      <X className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground" />
                    )}
                  </div>
                  {form.successUrl && !/^https?:\/\/.+/.test(form.successUrl) && (
                    <p className="text-xs text-foreground">Must start with http:// or https://</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Cancel URL (optional)</Label>
                  <div className="relative">
                    <Input
                      value={form.cancelUrl}
                      onChange={(e) => setForm((c) => ({ ...c, cancelUrl: e.target.value }))}
                      placeholder="https://app.yoursite.com/cancelled"
                      className={
                        form.cancelUrl && !/^https?:\/\/.+/.test(form.cancelUrl)
                          ? "border-red-500 pr-8"
                          : form.cancelUrl
                            ? "border-green-500 pr-8"
                            : ""
                      }
                    />
                    {form.cancelUrl && /^https?:\/\/.+/.test(form.cancelUrl) && (
                      <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground" />
                    )}
                    {form.cancelUrl && !/^https?:\/\/.+/.test(form.cancelUrl) && (
                      <X className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground" />
                    )}
                  </div>
                  {form.cancelUrl && !/^https?:\/\/.+/.test(form.cancelUrl) && (
                    <p className="text-xs text-foreground">Must start with http:// or https://</p>
                  )}
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Checkout Appearance" icon={Paintbrush} defaultOpen={false}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Checkout title</Label>
                  <Input
                    value={form.checkoutTitle}
                    onChange={(e) => setForm((c) => ({ ...c, checkoutTitle: e.target.value }))}
                    placeholder="Priority setup fee"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Brand name</Label>
                  <Input
                    value={form.brandName}
                    onChange={(e) => setForm((c) => ({ ...c, brandName: e.target.value }))}
                    placeholder="ArcenPay"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Checkout description</Label>
                <Textarea
                  value={form.checkoutDescription}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, checkoutDescription: e.target.value }))
                  }
                  className="h-20"
                  placeholder="What the customer is paying for and what happens after payment."
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Recipient display name</Label>
                  <Input
                    value={form.recipientName}
                    onChange={(e) => setForm((c) => ({ ...c, recipientName: e.target.value }))}
                    placeholder="Acme Labs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Pay button label</Label>
                  <Input
                    value={form.buttonLabel}
                    onChange={(e) => setForm((c) => ({ ...c, buttonLabel: e.target.value }))}
                    placeholder="Complete payment"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Palette className="h-3.5 w-3.5" />
                    Accent color
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`w-7 h-7 rounded-full cursor-pointer transition hover:scale-110 ${
                          form.accentColor === color
                            ? "ring-2 ring-offset-1 ring-offset-background ring-foreground"
                            : ""
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setForm((c) => ({ ...c, accentColor: color }))}
                        title={color}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.accentColor || "#000000"}
                      onChange={(e) => setForm((c) => ({ ...c, accentColor: e.target.value }))}
                      className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                    />
                    <Input
                      value={form.accentColor}
                      onChange={(e) => setForm((c) => ({ ...c, accentColor: e.target.value }))}
                      placeholder="#16a34a"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Logo URL</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={form.logoUrl}
                      onChange={(e) => setForm((c) => ({ ...c, logoUrl: e.target.value }))}
                      placeholder="https://yourcdn.com/logo.png"
                      className="flex-1"
                    />
                    {form.logoUrl && (
                      <div className="w-8 h-8 rounded border border-border/60 bg-secondary/10 flex items-center justify-center shrink-0 overflow-hidden">
                        {logoPreview && !logoPreviewError ? (
                          <img src={logoPreview} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border/40 bg-secondary/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Preview</p>
                <div className="rounded-lg border border-border/40 bg-card p-3 space-y-2">
                  {(form.logoUrl || form.brandName) ? (
                    <div className="flex items-center gap-2">
                      {form.logoUrl ? (
                        <div className="w-6 h-6 rounded overflow-hidden bg-secondary/30 flex items-center justify-center">
                          {logoPreview && !logoPreviewError ? (
                            <img src={logoPreview} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <ImageOff className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      ) : null}
                      {form.brandName ? (
                        <span className="text-xs font-medium">{form.brandName}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {form.checkoutTitle ? (
                    <p className="text-sm font-semibold">{form.checkoutTitle}</p>
                  ) : (
                    <p className="text-sm font-semibold text-muted-foreground/50">Checkout Title</p>
                  )}
                  {form.checkoutDescription ? (
                    <p className="text-xs text-muted-foreground">{form.checkoutDescription}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground/50">Checkout description placeholder</p>
                  )}
                  <div
                    className="w-full rounded-md py-1.5 text-center text-xs font-medium text-white"
                    style={{ backgroundColor: form.accentColor || "#16a34a" }}
                  >
                    {form.buttonLabel || "Pay"}
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Advanced" icon={Settings2} defaultOpen={false}>
              {companies.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Company association</Label>
                  <Select value={form.companyId} onValueChange={selectCompany}>
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Associate with a company (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{c.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {c.walletAddress?.slice(0, 8)}…
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Each session is single-use — duplicate payments are automatically rejected.
              </p>
            </CollapsibleSection>

            <Button onClick={() => void createCustomPaymentLink()} disabled={creating} className="w-full">
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

        {/* Payment links list */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Payment links</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Manage and share hosted checkout links.
              </p>
            </div>
            <Badge variant="outline">{paymentLinks.length}</Badge>
          </div>

          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <SkeletonCard lines={4} />
            </div>
          ) : paymentLinks.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-foreground">No payment links yet</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Create a custom link, or generate one from a one-time add-on or invoice.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
              {paymentLinks.map((link) => {
                const paidSessions = (link.checkoutSessions ?? []).filter(
                  (s) => s.status === "PAID",
                );
                const isActive = link.status === "ACTIVE";
                const appearance = readPaymentLinkCheckoutAppearance(link.metadata);
                const hasCustomization = Boolean(
                  appearance.title ||
                    appearance.description ||
                    appearance.brandName ||
                    appearance.buttonLabel ||
                    appearance.accentColor ||
                    appearance.logoUrl,
                );
                return (
                  <div
                    key={link.id}
                    className={`rounded-xl border p-4 transition ${
                      link.status === "ARCHIVED"
                        ? "border-border/40 bg-muted/20 opacity-60"
                        : "border-border bg-secondary/20"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium text-foreground">{link.name}</p>
                          <Badge variant="outline" className="text-[10px] px-1.5">
                            {LINK_KIND_LABELS[link.kind] ?? link.kind}
                          </Badge>
                          <Badge variant={statusVariant(link.status)} className="text-[10px] px-1.5">
                            {link.status.toLowerCase()}
                          </Badge>
                          {hasCustomization ? (
                            <Badge variant="outline" className="text-[10px] px-1.5">
                              Custom checkout
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {Number(link.amount).toFixed(2)} {link.currency}
                          </span>
                          {link.catalogAddOn && (
                            <span className="font-medium">{link.catalogAddOn.name}</span>
                          )}
                          {link.invoice && (
                            <span>Inv #{link.invoice.number}</span>
                          )}
                          <span className="font-mono">
                            to {link.recipientWallet.slice(0, 6)}…{link.recipientWallet.slice(-4)}
                          </span>
                        </div>
                        {paidSessions.length > 0 && (
                          <p className="mt-1 text-[11px] text-foreground">
                            {paidSessions.length} paid session{paidSessions.length > 1 ? "s" : ""}
                          </p>
                        )}
                        {link.expiresAt && (
                          <p className="mt-1 text-[11px] text-warning">
                            Expires {new Date(link.expiresAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <CopyButton value={link.checkoutUrl} label="" />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Open link"
                          asChild
                        >
                          <a href={link.checkoutUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        {link.status !== "ARCHIVED" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={isActive ? "Deactivate" : "Activate"}
                              onClick={() => toggleLinkStatus(link)}
                            >
                              {isActive ? (
                                <Link2Off className="h-3.5 w-3.5 text-foreground" />
                              ) : (
                                <Link2 className="h-3.5 w-3.5 text-foreground" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Edit"
                              onClick={() => openEdit(link)}
                            >
                              <Settings2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Archive"
                              onClick={() => archiveLink(link)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Checkout sessions table */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Checkout sessions</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Real hosted payment activity and verification status on {runtimeChainLabel}.
            </p>
          </div>
          <Badge variant="outline">{checkoutSessions.length}</Badge>
        </div>

        {loading ? (
          <div className="py-16">
            <SkeletonCard lines={3} />
          </div>
        ) : checkoutSessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-secondary/10 py-12 text-center">
            <ArrowUpRight className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              Sessions appear when a customer opens a hosted checkout link.
            </p>
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
                  <th className="py-2.5 pr-4">Tx Hash</th>
                  <th className="py-2.5 pr-0">Created</th>
                </tr>
              </thead>
              <tbody>
                {checkoutSessions.map((session) => (
                  <tr key={session.id} className="border-b border-border/40 hover:bg-secondary/10">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-foreground">
                        {session.paymentLink?.name ?? session.purpose}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {session.id.slice(0, 12)}…
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {session.company ? (
                        <div>
                          <p className="font-medium text-foreground">{session.company.name}</p>
                          {session.company.email && (
                            <p className="text-muted-foreground">{session.company.email}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">
                          {session.customerEmail || session.customerWallet
                            ? (session.customerEmail ?? session.customerWallet?.slice(0, 8) + "…")
                            : "—"}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-medium text-foreground">
                      {Number(session.amount).toFixed(2)} {session.currency}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={statusVariant(session.status)} className="text-[10px]">
                        {session.status.toLowerCase()}
                      </Badge>
                      {session.verificationError && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-foreground">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[120px]">{session.verificationError}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {session.txHash ? (
                        <span className="font-mono text-xs text-foreground">
                          {session.txHash.slice(0, 6)}…{session.txHash.slice(-4)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-0 text-xs text-muted-foreground">
                      {new Date(session.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit payment link</DialogTitle>
            <DialogDescription>
              Update the payment link details, redirects, and hosted checkout appearance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <CollapsibleSection title="Details" icon={Info} defaultOpen={true}>
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm((c) => ({ ...c, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((c) => ({ ...c, description: e.target.value }))}
                  className="h-20"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Recipient wallet</Label>
                <Input
                  value={editForm.recipientWallet}
                  onChange={(e) => setEditForm((c) => ({ ...c, recipientWallet: e.target.value }))}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Expires at</Label>
                <Input
                  type="datetime-local"
                  value={editForm.expiresAt}
                  onChange={(e) => setEditForm((c) => ({ ...c, expiresAt: e.target.value }))}
                />
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Redirect URLs" icon={Globe} defaultOpen={true}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Success URL</Label>
                  <div className="relative">
                    <Input
                      value={editForm.successUrl}
                      onChange={(e) => setEditForm((c) => ({ ...c, successUrl: e.target.value }))}
                      className={
                        editForm.successUrl && !/^https?:\/\/.+/.test(editForm.successUrl)
                          ? "border-red-500 pr-8"
                          : editForm.successUrl
                            ? "border-green-500 pr-8"
                            : ""
                      }
                    />
                    {editForm.successUrl && /^https?:\/\/.+/.test(editForm.successUrl) && (
                      <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground" />
                    )}
                    {editForm.successUrl && !/^https?:\/\/.+/.test(editForm.successUrl) && (
                      <X className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground" />
                    )}
                  </div>
                  {editForm.successUrl && !/^https?:\/\/.+/.test(editForm.successUrl) && (
                    <p className="text-xs text-foreground">Must start with http:// or https://</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Cancel URL</Label>
                  <div className="relative">
                    <Input
                      value={editForm.cancelUrl}
                      onChange={(e) => setEditForm((c) => ({ ...c, cancelUrl: e.target.value }))}
                      className={
                        editForm.cancelUrl && !/^https?:\/\/.+/.test(editForm.cancelUrl)
                          ? "border-red-500 pr-8"
                          : editForm.cancelUrl
                            ? "border-green-500 pr-8"
                            : ""
                      }
                    />
                    {editForm.cancelUrl && /^https?:\/\/.+/.test(editForm.cancelUrl) && (
                      <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground" />
                    )}
                    {editForm.cancelUrl && !/^https?:\/\/.+/.test(editForm.cancelUrl) && (
                      <X className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground" />
                    )}
                  </div>
                  {editForm.cancelUrl && !/^https?:\/\/.+/.test(editForm.cancelUrl) && (
                    <p className="text-xs text-foreground">Must start with http:// or https://</p>
                  )}
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Checkout Appearance" icon={Paintbrush} defaultOpen={false}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Checkout title</Label>
                  <Input
                    value={editForm.checkoutTitle}
                    onChange={(e) => setEditForm((c) => ({ ...c, checkoutTitle: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Brand name</Label>
                  <Input
                    value={editForm.brandName}
                    onChange={(e) => setEditForm((c) => ({ ...c, brandName: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Checkout description</Label>
                <Textarea
                  value={editForm.checkoutDescription}
                  onChange={(e) =>
                    setEditForm((c) => ({ ...c, checkoutDescription: e.target.value }))
                  }
                  className="h-20"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Recipient display name</Label>
                  <Input
                    value={editForm.recipientName}
                    onChange={(e) => setEditForm((c) => ({ ...c, recipientName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Pay button label</Label>
                  <Input
                    value={editForm.buttonLabel}
                    onChange={(e) => setEditForm((c) => ({ ...c, buttonLabel: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Palette className="h-3.5 w-3.5" />
                    Accent color
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`w-7 h-7 rounded-full cursor-pointer transition hover:scale-110 ${
                          editForm.accentColor === color
                            ? "ring-2 ring-offset-1 ring-offset-background ring-foreground"
                            : ""
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setEditForm((c) => ({ ...c, accentColor: color }))}
                        title={color}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={editForm.accentColor || "#000000"}
                      onChange={(e) => setEditForm((c) => ({ ...c, accentColor: e.target.value }))}
                      className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                    />
                    <Input
                      value={editForm.accentColor}
                      onChange={(e) => setEditForm((c) => ({ ...c, accentColor: e.target.value }))}
                      placeholder="#16a34a"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Logo URL</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={editForm.logoUrl}
                      onChange={(e) => setEditForm((c) => ({ ...c, logoUrl: e.target.value }))}
                      placeholder="https://yourcdn.com/logo.png"
                      className="flex-1"
                    />
                    {editForm.logoUrl && (
                      <div className="w-8 h-8 rounded border border-border/60 bg-secondary/10 flex items-center justify-center shrink-0 overflow-hidden">
                        {editLogoPreview && !editLogoPreviewError ? (
                          <img src={editLogoPreview} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageOff className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border/40 bg-secondary/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Preview</p>
                <div className="rounded-lg border border-border/40 bg-card p-3 space-y-2">
                  {(editForm.logoUrl || editForm.brandName) ? (
                    <div className="flex items-center gap-2">
                      {editForm.logoUrl ? (
                        <div className="w-6 h-6 rounded overflow-hidden bg-secondary/30 flex items-center justify-center">
                          {editLogoPreview && !editLogoPreviewError ? (
                            <img src={editLogoPreview} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <ImageOff className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      ) : null}
                      {editForm.brandName ? (
                        <span className="text-xs font-medium">{editForm.brandName}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {editForm.checkoutTitle ? (
                    <p className="text-sm font-semibold">{editForm.checkoutTitle}</p>
                  ) : (
                    <p className="text-sm font-semibold text-muted-foreground/50">Checkout Title</p>
                  )}
                  {editForm.checkoutDescription ? (
                    <p className="text-xs text-muted-foreground">{editForm.checkoutDescription}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground/50">Checkout description placeholder</p>
                  )}
                  <div
                    className="w-full rounded-md py-1.5 text-center text-xs font-medium text-white"
                    style={{ backgroundColor: editForm.accentColor || "#16a34a" }}
                  >
                    {editForm.buttonLabel || "Pay"}
                  </div>
                </div>
              </div>
            </CollapsibleSection>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
