"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Building2, Search, Plus, Wallet, Mail, ChevronRight,
  RefreshCw, Shield, Copy, Check, Users, ExternalLink,
  Zap, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { formatRelativeTime } from "@/lib/format";
import { SkeletonList, SkeletonCard } from "@/components/ui/skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  walletAddress: string | null;
  email: string | null;
  externalId: string | null;
  activePlanId: string | null;
  billingPeriod?: "monthly" | "annual" | null;
  activePlan?: {
    id: string;
    name: string;
    tier: string;
    price: string;
    annualPrice?: string | null;
    billingInterval?: number | null;
  } | null;
  createdAt: string;
  lastSeenAt: string;
}

interface CompanyDetail extends Company {
  users: { id: string; name: string | null; email: string | null; walletAddress: string | null; lastSeenAt: string }[];
  overrides: { id: string; featureKey: string; value: boolean; reason: string | null }[];
  entitlements: {
    featureKey: string;
    value: boolean;
    reason: string;
    allocation?: number | null;
    usage?: number;
    exceeded?: boolean;
  }[];
  activePlan: {
    id: string;
    name: string;
    tier: string;
    price: string;
    annualPrice?: string | null;
    billingInterval?: number | null;
  } | null;
  billingPeriod?: "monthly" | "annual" | null;
  addOnGrants: Array<{
    id: string;
    status: string;
    source: string;
    grantedAt: string;
    expiresAt?: string | null;
    cancelAtPeriodEnd: boolean;
    addOn: {
      id: string;
      name: string;
      code: string;
      billingType: string;
      saleMode: string;
      price: string;
      billingIntervalDays?: number | null;
      acceptedToken: string;
    };
  }>;
}

function formatPlanAmount(plan: Company["activePlan"], billingPeriod?: "monthly" | "annual" | null) {
  if (!plan) return "";
  const amount = billingPeriod === "annual" && plan.annualPrice
    ? plan.annualPrice
    : plan.price;
  const numericAmount = Number(amount);
  const suffix = billingPeriod === "annual" ? "/yr" : "/mo";
  return Number.isFinite(numericAmount)
    ? `$${numericAmount.toFixed(2)}${suffix}`
    : `${amount}${suffix}`;
}

function formatBillingPeriodLabel(value?: "monthly" | "annual" | null) {
  return value === "annual" ? "Yearly" : "Monthly";
}

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-foreground0" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ─── CompanyDetailContent (renders inside SheetContent) ───────────────────────

function CompanyDetailContent({ company, onClose }: { company: CompanyDetail; onClose: () => void }) {
  const enabled  = company.entitlements.filter((e) => e.value);
  const disabled = company.entitlements.filter((e) => !e.value);

  return (
    <>
      <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/60">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <SheetTitle className="truncate">{company.name}</SheetTitle>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {company.walletAddress && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                  <Wallet className="h-3 w-3" />
                  {company.walletAddress.slice(0, 10)}…{company.walletAddress.slice(-6)}
                  <CopyButton text={company.walletAddress} />
                </span>
              )}
              {company.email && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3" />{company.email}
                </span>
              )}
            </div>
          </div>
        </div>
        {company.externalId && (
          <SheetDescription className="font-mono text-xs mt-1">ID: {company.externalId}</SheetDescription>
        )}
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Active Plan */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Active Plan</h3>
          {company.activePlan ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex-1">
                <div className="font-medium text-sm">{company.activePlan.name}</div>
                <div className="text-xs text-muted-foreground">
                  {company.activePlan.tier} · {formatBillingPeriodLabel(company.billingPeriod)}
                </div>
              </div>
              <Badge variant="secondary" className="text-xs">
                {formatPlanAmount(company.activePlan, company.billingPeriod)}
              </Badge>
            </div>
          ) : (
            <div className="p-3 rounded-lg border border-dashed border-border/60 bg-muted/20 text-sm text-muted-foreground">
              No active plan
            </div>
          )}
        </section>

        {/* Entitlements */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" /> Entitlements
          </h3>
          {company.entitlements.length === 0 ? (
            <div className="p-3 rounded-lg border border-dashed border-border/60 bg-muted/20 text-sm text-muted-foreground">
              No feature flags configured
            </div>
          ) : (
            <div className="space-y-1.5">
              {enabled.map((e) => (
                <div key={e.featureKey} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary border border-emerald-500/20">
                  <div>
                    <span className="font-mono text-xs">{e.featureKey}</span>
                    {(e.allocation !== null && e.allocation !== undefined) && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {e.usage ?? 0} / {e.allocation} used
                        {e.exceeded ? " · limit reached" : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-secondary text-foreground border-border text-xs dark:text-foreground">✓ True</Badge>
                    <span className="text-xs text-muted-foreground/70">{e.reason}</span>
                  </div>
                </div>
              ))}
              {disabled.map((e) => (
                <div key={e.featureKey} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 border border-border/40">
                  <div>
                    <span className="font-mono text-xs text-muted-foreground">{e.featureKey}</span>
                    {(e.allocation !== null && e.allocation !== undefined) && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {e.usage ?? 0} / {e.allocation} used
                        {e.exceeded ? " · limit reached" : ""}
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs text-muted-foreground">✗ False</Badge>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Active Add-Ons
          </h3>
          {company.addOnGrants.length === 0 ? (
            <div className="p-3 rounded-lg border border-dashed border-border/60 bg-muted/20 text-sm text-muted-foreground">
              No add-ons granted yet
            </div>
          ) : (
            <div className="space-y-1.5">
              {company.addOnGrants.map((grant) => (
                <div key={grant.id} className="rounded-lg border border-border/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">{grant.addOn.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {grant.source.toLowerCase().replace(/_/g, " ")} · {grant.addOn.billingType === "RECURRING"
                          ? grant.addOn.billingIntervalDays
                            ? `every ${grant.addOn.billingIntervalDays} days`
                            : "recurring"
                          : "one-time"}
                      </div>
                    </div>
                    <Badge variant={grant.status === "ACTIVE" ? "secondary" : "outline"} className="text-xs">
                      {grant.status.toLowerCase()}
                    </Badge>
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Granted {new Date(grant.grantedAt).toLocaleDateString()}
                    {grant.cancelAtPeriodEnd ? " · ends at renewal" : ""}
                    {grant.expiresAt ? ` · expires ${new Date(grant.expiresAt).toLocaleDateString()}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Overrides */}
        {company.overrides.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-warning mb-2 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Company Overrides
            </h3>
            <div className="space-y-1.5 p-3 rounded-lg border border-border bg-secondary">
              {company.overrides.map((o) => (
                <div key={o.id} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs">{o.featureKey}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={o.value ? "default" : "destructive"} className="text-xs">
                      {o.value ? "True" : "False"}
                    </Badge>
                    {o.reason && <span className="text-xs text-muted-foreground">{o.reason}</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Users */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Users
            <Badge variant="secondary" className="text-xs ml-1">{company.users.length}</Badge>
          </h3>
          {company.users.length === 0 ? (
            <div className="p-3 rounded-lg border border-dashed border-border/60 bg-muted/20 text-sm text-muted-foreground">
              No users identified for this company
            </div>
          ) : (
            <div className="space-y-1.5">
              {company.users.map((u) => (
                <div key={u.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/40">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-medium flex-shrink-0">
                      {(u.name ?? u.email ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{u.name ?? u.email ?? "Unknown"}</div>
                      {u.walletAddress && (
                        <div className="text-xs font-mono text-muted-foreground">{u.walletAddress.slice(0, 8)}…</div>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(new Date(u.lastSeenAt).getTime() / 1000)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Meta */}
        <section className="pt-2 border-t border-border/40 space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Created</span>
            <span>{new Date(company.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Last seen</span>
            <span>{formatRelativeTime(new Date(company.lastSeenAt).getTime() / 1000)}</span>
          </div>
        </section>
      </div>

      <SheetFooter className="px-6 py-4 border-t border-border/60">
        <Button variant="outline" size="sm" onClick={onClose} className="w-full">Close</Button>
      </SheetFooter>
    </>
  );
}

// ─── Create Company Sheet ─────────────────────────────────────────────────────

function CreateCompanySheet({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ name: "", wallet: "", email: "", externalId: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const reset = () => { setForm({ name: "", wallet: "", email: "", externalId: "" }); setError(""); };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/v1/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          wallet: form.wallet || undefined,
          email:  form.email  || undefined,
          id:     form.externalId || undefined,
        }),
      });
      if (res.ok) {
        reset();
        onOpenChange(false);
        onCreated();
      } else {
        const body = await res.json() as { error?: string };
        setError(body.error ?? "Failed to create company");
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <SheetContent side="right" className="sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/60">
          <SheetTitle>Add Company</SheetTitle>
          <SheetDescription>
            Companies are identified by wallet address, email, or external ID.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="co-name">Name <span className="text-destructive">*</span></Label>
            <Input id="co-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Corp" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-wallet">Wallet Address <span className="text-xs font-normal text-muted-foreground ml-1">(EVM)</span></Label>
            <Input id="co-wallet" value={form.wallet} onChange={(e) => setForm({ ...form, wallet: e.target.value })} placeholder="0x..." className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-email">Email</Label>
            <Input id="co-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="team@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-extid">External ID <span className="text-xs font-normal text-muted-foreground ml-1">(your system&apos;s ID)</span></Label>
            <Input id="co-extid" value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} placeholder="org_1234" className="font-mono text-xs" />
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border/40">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">Provide at least one identifier so the protocol can match future events and flag checks to this company.</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary border border-border text-destructive text-sm">
              <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />{error}
            </div>
          )}
        </div>

        <SheetFooter className="px-6 py-4 border-t border-border/60 flex-row gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="flex-1">Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={creating || !form.name.trim()} className="flex-1">
            {creating ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating…</> : "Add Company"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function CompaniesSection() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [detailCompany, setDetailCompany] = useState<CompanyDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/v1/companies?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { data: Company[] };
        setCompanies(data.data);
      }
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const openDetail = async (company: Company) => {
    setLoadingDetail(true);
    setDetailCompany(null);
    setDetailOpen(true);
    try {
      const res = await fetch(`/api/v1/companies/${company.id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { data: CompanyDetail };
        setDetailCompany(data.data);
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeDetail = () => { setDetailOpen(false); setDetailCompany(null); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Manage customer companies — plans, entitlements, and overrides.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchCompanies} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Company
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email, or wallet…" className="pl-9" />
      </div>

      {/* Table */}
      {loading ? (
        <SkeletonList items={4} />
      ) : companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-14 text-center space-y-3">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="font-medium">{search ? "No companies match your search" : "No companies yet"}</p>
            <p className="text-sm text-muted-foreground mt-1">{search ? "Try a different term." : "Add your first company or send events via the SDK."}</p>
          </div>
          {!search && <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1.5" /> Add Company</Button>}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Company</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Wallet</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Email</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Plan</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Last Seen</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {companies.map((c) => (
                <tr key={c.id} onClick={() => openDetail(c)} className="hover:bg-muted/30 cursor-pointer transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {c.walletAddress ? (
                      <span className="flex items-center font-mono text-xs text-muted-foreground">
                        {c.walletAddress.slice(0, 8)}…{c.walletAddress.slice(-6)}
                        <CopyButton text={c.walletAddress} />
                      </span>
                    ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground hidden lg:table-cell">{c.email ?? <span className="text-muted-foreground/40 text-xs">—</span>}</td>
                  <td className="px-4 py-3">
                    {c.activePlan ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium">{c.activePlan.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatBillingPeriodLabel(c.billingPeriod)} · {formatPlanAmount(c.activePlan, c.billingPeriod)}
                        </span>
                      </div>
                    ) : c.activePlanId ? (
                      <Badge variant="secondary" className="text-xs">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground/50">—</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">
                    {formatRelativeTime(new Date(c.lastSeenAt).getTime() / 1000)}
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create sheet */}
      <CreateCompanySheet open={showCreate} onOpenChange={setShowCreate} onCreated={fetchCompanies} />

      {/* Detail sheet */}
      <Sheet open={detailOpen} onOpenChange={(v) => { if (!v) closeDetail(); }}>
        <SheetContent side="right" className="sm:max-w-xl flex flex-col p-0 overflow-y-auto">
          {loadingDetail ? (
            <div className="px-6 py-5">
              <SkeletonCard lines={6} />
            </div>
          ) : detailCompany ? (
            <CompanyDetailContent company={detailCompany} onClose={closeDetail} />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
