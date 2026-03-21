"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Building2,
  Search,
  Plus,
  Wallet,
  Mail,
  ChevronRight,
  RefreshCw,
  Shield,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";

interface Company {
  id: string;
  name: string;
  walletAddress: string | null;
  email: string | null;
  externalId: string | null;
  activePlanId: string | null;
  createdAt: string;
  lastSeenAt: string;
}

interface CompanyDetail extends Company {
  users: { id: string; name: string | null; email: string | null; walletAddress: string | null; lastSeenAt: string }[];
  overrides: { id: string; featureKey: string; value: boolean; reason: string | null }[];
  entitlements: { featureKey: string; value: boolean; reason: string }[];
  activePlan: { id: string; name: string; tier: string; price: string } | null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-1 text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function CompanyRow({ company, onClick }: { company: Company; onClick: () => void }) {
  return (
    <tr className="hover:bg-muted/30 cursor-pointer border-b border-border/50" onClick={onClick}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-sm">{company.name}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        {company.walletAddress ? (
          <div className="flex items-center font-mono text-xs text-muted-foreground">
            {company.walletAddress.slice(0, 8)}...{company.walletAddress.slice(-6)}
            <CopyButton text={company.walletAddress} />
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{company.email ?? "—"}</td>
      <td className="px-4 py-3">
        {company.activePlanId ? (
          <Badge variant="secondary" className="text-xs">Active Plan</Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">No Plan</Badge>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{formatRelativeTime(new Date(company.lastSeenAt).getTime() / 1000)}</td>
      <td className="px-4 py-3"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
    </tr>
  );
}

function CompanyDetail({ company, onBack }: { company: CompanyDetail; onBack: () => void }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <h2 className="text-lg font-semibold">{company.name}</h2>
        {company.walletAddress && (
          <Badge variant="secondary" className="font-mono text-xs">
            <Wallet className="h-3 w-3 mr-1" />
            {company.walletAddress.slice(0, 8)}...{company.walletAddress.slice(-6)}
          </Badge>
        )}
      </div>

      {/* Active Plan */}
      <div className="rounded-lg border border-border p-4">
        <h3 className="font-medium mb-2 text-sm">Active Plan</h3>
        {company.activePlan ? (
          <div className="flex items-center gap-3">
            <Badge className="bg-primary/10 text-primary">{company.activePlan.name}</Badge>
            <span className="text-sm text-muted-foreground">{company.activePlan.tier}</span>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">No active plan</span>
        )}
      </div>

      {/* Entitlements */}
      <div className="rounded-lg border border-border p-4">
        <h3 className="font-medium mb-3 text-sm flex items-center gap-2">
          <Shield className="h-4 w-4" /> Entitlements
        </h3>
        {company.entitlements.length === 0 ? (
          <span className="text-muted-foreground text-sm">No feature flags configured</span>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {company.entitlements.map((e) => (
              <div key={e.featureKey} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{e.featureKey}</span>
                <Badge variant={e.value ? "default" : "outline"} className="text-xs">
                  {e.value ? "✓ True" : "✗ False"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Overrides */}
      {company.overrides.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-4">
          <h3 className="font-medium mb-3 text-sm text-amber-700 dark:text-amber-400">Company Overrides</h3>
          <div className="space-y-2">
            {company.overrides.map((o) => (
              <div key={o.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{o.featureKey}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={o.value ? "default" : "destructive"} className="text-xs">
                    {o.value ? "Override: True" : "Override: False"}
                  </Badge>
                  {o.reason && <span className="text-xs text-muted-foreground">{o.reason}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Users */}
      <div className="rounded-lg border border-border p-4">
        <h3 className="font-medium mb-3 text-sm">Users ({company.users.length})</h3>
        {company.users.length === 0 ? (
          <span className="text-muted-foreground text-sm">No users identified</span>
        ) : (
          <div className="space-y-2">
            {company.users.map((u) => (
              <div key={u.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs">
                    {(u.name ?? u.email ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <span>{u.name ?? u.email ?? "Unknown"}</span>
                  {u.walletAddress && (
                    <span className="text-xs font-mono text-muted-foreground">
                      {u.walletAddress.slice(0, 6)}...
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(new Date(u.lastSeenAt).getTime() / 1000)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CompaniesSection() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<CompanyDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", wallet: "", email: "" });
  const [creating, setCreating] = useState(false);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/v1/companies?${params}`);
      if (res.ok) {
        const data = await res.json() as { data: Company[] };
        setCompanies(data.data);
      }
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const openCompanyDetail = async (company: Company) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/v1/companies/${company.id}`);
      if (res.ok) {
        const data = await res.json() as { data: CompanyDetail };
        setSelectedCompany(data.data);
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name,
          wallet: createForm.wallet || undefined,
          email: createForm.email || undefined,
        }),
      });
      if (res.ok) {
        setShowCreateModal(false);
        setCreateForm({ name: "", wallet: "", email: "" });
        fetchCompanies();
      }
    } finally {
      setCreating(false);
    }
  };

  if (selectedCompany) {
    return <CompanyDetail company={selectedCompany} onBack={() => setSelectedCompany(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage customer companies — their plans, entitlements, and overrides.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchCompanies} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Company
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or wallet..."
          className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Wallet</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Plan</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Seen</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : companies.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                {search ? "No companies match your search" : "No companies yet. Add your first company."}
              </td></tr>
            ) : (
              companies.map((c) => (
                <CompanyRow
                  key={c.id}
                  company={c}
                  onClick={() => openCompanyDetail(c)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg border border-border p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Add Company</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name *</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="Acme Corp"
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Wallet Address</label>
                <input
                  type="text"
                  value={createForm.wallet}
                  onChange={(e) => setCreateForm({ ...createForm, wallet: e.target.value })}
                  placeholder="0x..."
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  placeholder="team@company.com"
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowCreateModal(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={creating || !createForm.name.trim()}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {loadingDetail && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40">
          <div className="bg-background rounded-lg p-4 text-sm">Loading company details...</div>
        </div>
      )}
    </div>
  );
}
