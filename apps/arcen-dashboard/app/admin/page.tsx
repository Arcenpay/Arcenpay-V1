"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ShieldAlert,
  KeyRound,
  Plus,
  Copy,
  Check,
  Search,
  Filter,
  RefreshCw,
  Trash2,
  Users,
  Building2,
  Lock,
  Unlock,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Eye,
  SlidersHorizontal,
  XCircle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isPlatformAdminEmail } from "@/lib/admin";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { useDashboardSession } from "@/hooks/use-dashboard-session";

interface ActivationKeyItem {
  id: string;
  key: string;
  name: string;
  recipientEmail: string | null;
  recipientName: string | null;
  tier: "FREE" | "PLUS" | "PRO";
  allowPlatformBilling: boolean;
  maxUses: number;
  usedCount: number;
  status: "ACTIVE" | "REVOKED" | "EXHAUSTED" | "EXPIRED";
  expiresAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  notes: string | null;
  createdAt: string;
  redemptionsCount: number;
  teamsCount: number;
}

interface KeyStats {
  totalKeys: number;
  activeKeys: number;
  revokedKeys: number;
  exhaustedKeys: number;
  expiredKeys: number;
  totalRedemptions: number;
}

interface RedemptionDetail {
  id: string;
  createdAt: string;
  teamId: string;
  userId: string | null;
  userEmail: string | null;
  walletAddress: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  team?: {
    id: string;
    name: string;
    slug: string;
    platformTier: string;
    isPlatformActivated: boolean;
    createdAt: string;
  };
}

export default function AdminPage() {
  const { data: sessionData, isLoading: sessionLoading } = useDashboardSession();
  const [adminSecret, setAdminSecret] = useState<string>("");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [checkingAuth, setCheckingAuth] = useState<boolean>(true);

  const userEmail = sessionData?.user?.email?.toLowerCase();
  const isAuthorizedAdmin =
    sessionData?.user?.isPlatformAdmin === true ||
    isPlatformAdminEmail(sessionData?.user?.email);

  // Data states
  const [keys, setKeys] = useState<ActivationKeyItem[]>([]);
  const [stats, setStats] = useState<KeyStats | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [tierFilter, setTierFilter] = useState<string>("ALL");

  // Create Key Modal states
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);
  const [newKeyForm, setNewKeyForm] = useState({
    name: "",
    recipientEmail: "",
    recipientName: "",
    tier: "PRO" as "FREE" | "PLUS" | "PRO",
    allowPlatformBilling: true,
    maxUses: 1,
    expiresInDays: "never",
    customKey: "",
    notes: "",
  });

  // Redemption Details Sheet state
  const [selectedKey, setSelectedKey] = useState<ActivationKeyItem | null>(null);
  const [redemptions, setRedemptions] = useState<RedemptionDetail[]>([]);
  const [loadingRedemptions, setLoadingRedemptions] = useState<boolean>(false);

  // Copied state tracking
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Initialize admin secret from sessionStorage or cookie
  useEffect(() => {
    const saved = sessionStorage.getItem("arcen_admin_secret");
    if (saved) {
      setAdminSecret(saved);
      void verifySecret(saved);
    } else {
      // Try verifying with default dev or existing cookie
      void verifySecret("");
    }
  }, []);

  const verifySecret = async (secretToTest: string) => {
    setCheckingAuth(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (secretToTest) {
        headers["x-admin-secret"] = secretToTest;
      }

      const res = await fetch("/api/admin/activation-keys/verify-secret", {
        method: "POST",
        headers,
      });

      if (res.ok) {
        setIsAuthenticated(true);
        if (secretToTest) {
          sessionStorage.setItem("arcen_admin_secret", secretToTest);
        }
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setCheckingAuth(false);
    }
  };

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (adminSecret) {
      headers["x-admin-secret"] = adminSecret;
    }
    return headers;
  }, [adminSecret]);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (search.trim()) queryParams.set("search", search.trim());
      if (statusFilter !== "ALL") queryParams.set("status", statusFilter);
      if (tierFilter !== "ALL") queryParams.set("tier", tierFilter);

      const [keysRes, statsRes] = await Promise.all([
        fetch(`/api/admin/activation-keys?${queryParams.toString()}`, {
          headers: getAuthHeaders(),
        }),
        fetch("/api/admin/activation-keys/stats", {
          headers: getAuthHeaders(),
        }),
      ]);

      if (keysRes.ok) {
        const keysData = await keysRes.json();
        setKeys(keysData.items || []);
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.data);
      }
    } catch (err) {
      toast.error("Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, search, statusFilter, tierFilter, getAuthHeaders]);

  useEffect(() => {
    if (isAuthenticated) {
      void fetchData();
    }
  }, [isAuthenticated, fetchData]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    toast.success("Activation key copied to clipboard");
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminSecret.trim()) {
      toast.error("Please enter the admin secret");
      return;
    }
    void verifySecret(adminSecret.trim());
  };

  const handleCreateKey = async () => {
    if (!newKeyForm.name.trim()) {
      toast.error("Organization / Recipient Name is required");
      return;
    }

    setCreating(true);
    try {
      let expiresAt: string | undefined = undefined;
      if (newKeyForm.expiresInDays !== "never") {
        const days = parseInt(newKeyForm.expiresInDays, 10);
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + days);
        expiresAt = expDate.toISOString();
      }

      const payload = {
        name: newKeyForm.name.trim(),
        recipientEmail: newKeyForm.recipientEmail.trim() || undefined,
        recipientName: newKeyForm.recipientName.trim() || undefined,
        tier: newKeyForm.tier,
        allowPlatformBilling: newKeyForm.allowPlatformBilling,
        maxUses: Number(newKeyForm.maxUses) || 1,
        expiresAt,
        key: newKeyForm.customKey.trim() || undefined,
        notes: newKeyForm.notes.trim() || undefined,
      };

      const res = await fetch("/api/admin/activation-keys", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(`Activation Key created: ${data.data.key}`);
        setCreateModalOpen(false);
        setNewKeyForm({
          name: "",
          recipientEmail: "",
          recipientName: "",
          tier: "PRO",
          allowPlatformBilling: true,
          maxUses: 1,
          expiresInDays: "never",
          customKey: "",
          notes: "",
        });
        void fetchData();
      } else {
        toast.error(data.error || "Failed to create activation key");
      }
    } catch {
      toast.error("Network error creating key");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyItem: ActivationKeyItem) => {
    if (!confirm(`Are you sure you want to revoke key ${keyItem.key}? This will immediately deactivate platform access for all associated workspaces.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/activation-keys/${keyItem.id}/revoke`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason: "Revoked by platform administrator via Admin Console" }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(`Key ${keyItem.key} revoked. ${data.data.affectedTeamsCount} workspace(s) suspended.`);
        void fetchData();
      } else {
        toast.error(data.error || "Failed to revoke key");
      }
    } catch {
      toast.error("Network error revoking key");
    }
  };

  const handleReactivate = async (keyItem: ActivationKeyItem) => {
    try {
      const res = await fetch(`/api/admin/activation-keys/${keyItem.id}/reactivate`, {
        method: "POST",
        headers: getAuthHeaders(),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(`Key ${keyItem.key} restored. Workspace access reactivated.`);
        void fetchData();
      } else {
        toast.error(data.error || "Failed to reactivate key");
      }
    } catch {
      toast.error("Network error reactivating key");
    }
  };

  const handleViewRedemptions = async (keyItem: ActivationKeyItem) => {
    setSelectedKey(keyItem);
    setLoadingRedemptions(true);
    try {
      const res = await fetch(`/api/admin/activation-keys/${keyItem.id}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRedemptions(data.data.redemptions || []);
      }
    } catch {
      toast.error("Failed to load redemption details");
    } finally {
      setLoadingRedemptions(false);
    }
  };

  // ── Render: Session Loading ────────────────────────────────────────────────
  if (sessionLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand" />
          <p className="text-xs text-muted-foreground font-medium">Verifying administrator credentials…</p>
        </div>
      </div>
    );
  }

  // ── Render: Access Restricted Screen (Non-Admin Users) ──────────────────────
  if (!isAuthorizedAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-6 border border-destructive/30 shadow-xl space-y-6 bg-card">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <Badge variant="outline" className="text-[10px] font-mono uppercase bg-destructive/10 text-destructive border-destructive/20 px-2 py-0.5">
              Access Restricted
            </Badge>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Platform Admin Only</h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This administrative control plane is strictly restricted to platform administrators.
            </p>
          </div>

          <div className="w-full p-3.5 rounded-xl bg-secondary/50 border border-border space-y-1 text-left">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Account</p>
            <p className="text-xs font-mono font-medium text-foreground truncate">
              {sessionData?.user?.email || "No email linked to session"}
            </p>
            <p className="text-[11px] text-destructive flex items-center gap-1 pt-1">
              <XCircle className="w-3 h-3 shrink-0" /> Administrative privileges not granted
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <Button
              variant="default"
              className="w-full font-medium"
              onClick={() => window.location.assign("/login?redirect=/admin")}
            >
              Switch to Admin Account
            </Button>
            <Button
              variant="outline"
              className="w-full"
              asChild
            >
              <Link href="/">
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Return to Dashboard
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ── Render: Passkey Unlock Screen for Verified Admin ───────────────────────
  if (!isAuthenticated && !checkingAuth) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-6 border border-border shadow-lg space-y-6">
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 mb-1">
              <Lock className="w-6 h-6" />
            </div>
            <div className="flex items-center gap-1.5">
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] font-mono">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Verified Admin
              </Badge>
            </div>
            <h1 className="text-xl font-bold tracking-tight">Platform Admin Console</h1>
            <p className="text-xs text-muted-foreground">
              Welcome <strong>{sessionData?.user?.email || "Platform Administrator"}</strong>. Enter your administrator passkey to unlock the control plane.
            </p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Admin Secret Passkey
              </label>
              <Input
                type="password"
                placeholder="Enter PLATFORM_ADMIN_SECRET..."
                value={adminSecret}
                onChange={(e) => setAdminSecret(e.target.value)}
                className="font-mono text-sm"
                autoFocus
              />
            </div>

            <Button type="submit" className="w-full font-semibold">
              Unlock Admin Console
            </Button>
          </form>

          <div className="pt-2 border-t border-border text-center">
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Back to Dashboard
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // ── Render: Main Admin Console ─────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col">
      {/* Top Navbar */}
      <header className="h-16 border-b border-border bg-card/50 backdrop-blur px-4 sm:px-8 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mr-2">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm tracking-tight text-foreground">ArcenPay Admin</span>
            <Badge variant="outline" className="text-[10px] font-mono uppercase bg-brand/10 text-brand border-brand/20">
              License Ops
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void fetchData()}
            disabled={loading}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateModalOpen(true)}
            className="h-8 gap-1.5 text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Generate Key</span>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto space-y-6">
        {/* Page Title & Subtitle */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Platform Activation Keys & Licenses
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate, track, and revoke access keys. Control tenant subscription tiers and self-service platform billing allowances.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 border-border bg-card">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Keys</span>
              <KeyRound className="w-4 h-4 text-brand" />
            </div>
            <div className="text-2xl font-bold font-mono">{stats?.totalKeys ?? keys.length}</div>
            <p className="text-[11px] text-muted-foreground mt-1">Generated licenses</p>
          </Card>

          <Card className="p-4 border-border bg-card">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Keys</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {stats?.activeKeys ?? keys.filter((k) => k.status === "ACTIVE").length}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Eligible for redemption</p>
          </Card>

          <Card className="p-4 border-border bg-card">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Redemptions</span>
              <Users className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400">
              {stats?.totalRedemptions ?? keys.reduce((acc, k) => acc + k.usedCount, 0)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Activated workspaces</p>
          </Card>

          <Card className="p-4 border-border bg-card">
            <div className="flex items-center justify-between text-muted-foreground mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Revoked</span>
              <XCircle className="w-4 h-4 text-red-500" />
            </div>
            <div className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">
              {stats?.revokedKeys ?? keys.filter((k) => k.status === "REVOKED").length}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Suspended access</p>
          </Card>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search key, recipient, or email..."
              className="pl-9 h-9 text-xs"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="EXHAUSTED">Exhausted</option>
              <option value="REVOKED">Revoked</option>
              <option value="EXPIRED">Expired</option>
            </select>

            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="ALL">All Tiers</option>
              <option value="PRO">Enterprise (PRO)</option>
              <option value="PLUS">Growth (PLUS)</option>
              <option value="FREE">Starter (FREE)</option>
            </select>
          </div>
        </div>

        {/* Keys Table */}
        <Card className="border border-border overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/50 border-b border-border text-muted-foreground uppercase font-semibold text-[11px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Key Code</th>
                  <th className="py-3 px-4">Organization / Recipient</th>
                  <th className="py-3 px-4">Granted Tier</th>
                  <th className="py-3 px-4">Self-Billing</th>
                  <th className="py-3 px-4">Usage</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && keys.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 opacity-60" />
                      Loading activation keys...
                    </td>
                  </tr>
                ) : keys.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No activation keys found. Click "Generate Key" above to create one.
                    </td>
                  </tr>
                ) : (
                  keys.map((k) => (
                    <tr key={k.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold">
                        <div className="flex items-center gap-1.5">
                          <span>{k.key}</span>
                          <button
                            onClick={() => handleCopy(k.key)}
                            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy key"
                          >
                            {copiedKey === k.key ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">{k.name}</div>
                        {k.recipientEmail && (
                          <div className="text-[11px] text-muted-foreground">{k.recipientEmail}</div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant="outline"
                          className={`font-semibold ${
                            k.tier === "PRO"
                              ? "bg-blue-600 text-white border-blue-600 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40"
                              : k.tier === "PLUS"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {k.tier === "PRO" ? "Enterprise" : k.tier === "PLUS" ? "Growth" : "Starter"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        {k.allowPlatformBilling ? (
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                            Enabled
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20">
                            Locked / Managed
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold font-mono">
                            {k.usedCount} / {k.maxUses}
                          </span>
                          {k.usedCount > 0 && (
                            <button
                              onClick={() => void handleViewRedemptions(k)}
                              className="text-[11px] text-brand hover:underline font-medium ml-1"
                            >
                              view
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant="outline"
                          className={`font-semibold text-[10px] ${
                            k.status === "ACTIVE"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                              : k.status === "REVOKED"
                              ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
                              : k.status === "EXHAUSTED"
                              ? "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                          }`}
                        >
                          {k.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                        {new Date(k.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap space-x-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleViewRedemptions(k)}
                          className="h-7 px-2 text-xs"
                        >
                          Details
                        </Button>
                        {k.status === "REVOKED" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleReactivate(k)}
                            className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-700"
                          >
                            Reactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleRevoke(k)}
                            className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                          >
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </main>

      {/* ── Modal: Create Activation Key ── */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-brand" />
              Generate Platform Activation Key
            </DialogTitle>
            <DialogDescription>
              Create an onboarding license key. Specify the subscription tier and billing controls to enforce.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <label className="font-semibold text-foreground">
                Organization / Client Name <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="e.g. Acme Corp Enterprise Pilot"
                value={newKeyForm.name}
                onChange={(e) => setNewKeyForm({ ...newKeyForm, name: e.target.value })}
                className="h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-foreground">Recipient Email</label>
                <Input
                  type="email"
                  placeholder="admin@acme.com"
                  value={newKeyForm.recipientEmail}
                  onChange={(e) => setNewKeyForm({ ...newKeyForm, recipientEmail: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-foreground">Max Redemptions</label>
                <Input
                  type="number"
                  min={1}
                  value={newKeyForm.maxUses}
                  onChange={(e) => setNewKeyForm({ ...newKeyForm, maxUses: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-foreground">Granted Subscription Tier</label>
              <div className="grid grid-cols-3 gap-2">
                {(["FREE", "PLUS", "PRO"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewKeyForm({ ...newKeyForm, tier: t })}
                    className={`p-2.5 rounded-lg border text-center transition-all ${
                      newKeyForm.tier === t
                        ? "border-brand bg-brand/5 ring-1 ring-brand font-semibold text-foreground"
                        : "border-border hover:bg-accent/50 text-muted-foreground"
                    }`}
                  >
                    <div className="font-medium text-xs">
                      {t === "PRO" ? "Enterprise" : t === "PLUS" ? "Growth" : "Starter"}
                    </div>
                    <div className="text-[10px] opacity-70">({t})</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Platform Billing Permission Toggle */}
            <div className="p-3 rounded-lg border border-border bg-muted/30 flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <span>Allow Platform Self-Billing</span>
                  {newKeyForm.allowPlatformBilling ? (
                    <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                      Enabled
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/20">
                      Locked to Tier
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {newKeyForm.allowPlatformBilling
                    ? "Tenant can self-service upgrade on-chain using USDC micropayments."
                    : "Tenant is locked to the default subscription. Platform billing paywalls are suppressed."}
                </p>
              </div>
              <Switch
                checked={newKeyForm.allowPlatformBilling}
                onCheckedChange={(val) => setNewKeyForm({ ...newKeyForm, allowPlatformBilling: val })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-foreground">Expiration Period</label>
                <select
                  value={newKeyForm.expiresInDays}
                  onChange={(e) => setNewKeyForm({ ...newKeyForm, expiresInDays: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="never">Never (Perpetual)</option>
                  <option value="30">30 Days</option>
                  <option value="90">90 Days</option>
                  <option value="365">1 Year</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-foreground">Custom Key Code (Optional)</label>
                <Input
                  placeholder="Leave empty for auto ARCN-..."
                  value={newKeyForm.customKey}
                  onChange={(e) => setNewKeyForm({ ...newKeyForm, customKey: e.target.value })}
                  className="h-9 text-xs uppercase font-mono"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-foreground">Internal Notes (Optional)</label>
              <Input
                placeholder="e.g. Approved by Sales for Seed round discount"
                value={newKeyForm.notes}
                onChange={(e) => setNewKeyForm({ ...newKeyForm, notes: e.target.value })}
                className="h-9 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateKey} disabled={creating} className="font-semibold">
              {creating ? "Generating..." : "Generate Activation Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Sheet: Redemptions & Usage Details ── */}
      <Sheet open={!!selectedKey} onOpenChange={(open) => !open && setSelectedKey(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-brand" />
              Redemption Audit Log
            </SheetTitle>
            <SheetDescription>
              Workspaces and identities that activated using key{" "}
              <span className="font-mono font-semibold text-foreground">{selectedKey?.key}</span>.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4 text-xs">
            <div className="p-3 rounded-lg border border-border bg-muted/40 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recipient Name:</span>
                <span className="font-medium text-foreground">{selectedKey?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Granted Tier:</span>
                <Badge variant="outline" className="font-semibold text-[10px]">
                  {selectedKey?.tier}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Platform Billing:</span>
                <span>{selectedKey?.allowPlatformBilling ? "Allowed" : "Locked / Managed"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Usage Ratio:</span>
                <span className="font-mono font-semibold">
                  {selectedKey?.usedCount} of {selectedKey?.maxUses} redeemed
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Redeemed Workspaces ({redemptions.length})
              </h3>

              {loadingRedemptions ? (
                <div className="py-6 text-center text-muted-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 opacity-60" />
                  Loading redemptions...
                </div>
              ) : redemptions.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground border border-dashed rounded-lg">
                  No redemptions recorded yet for this key.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {redemptions.map((r) => (
                    <div key={r.id} className="p-3 rounded-lg border border-border bg-card space-y-1.5">
                      <div className="flex items-center justify-between font-medium text-foreground">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>{r.team?.name || r.teamId}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      {r.userEmail && (
                        <div className="text-[11px] text-muted-foreground">
                          Email: <span className="text-foreground">{r.userEmail}</span>
                        </div>
                      )}
                      {r.walletAddress && (
                        <div className="text-[11px] text-muted-foreground font-mono truncate">
                          Wallet: {r.walletAddress}
                        </div>
                      )}
                      {r.ipAddress && (
                        <div className="text-[10px] text-muted-foreground opacity-80">
                          IP: {r.ipAddress}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
