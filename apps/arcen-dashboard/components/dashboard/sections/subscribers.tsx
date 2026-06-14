"use client";

import { useCallback, useEffect, useState } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import {
  Users,
  Search,
  RefreshCw,
  Plus,
  Mail,
  Wallet,
  Building2,
  Copy,
  Check,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatRelativeTime } from "@/lib/format";

interface UserRecord {
  id: string;
  name: string | null;
  email: string | null;
  walletAddress: string | null;
  clerkUserId: string | null;
  externalId: string | null;
  companyId: string;
  createdAt: string;
  lastSeenAt: string;
  company?: {
    id: string;
    name: string;
    email: string | null;
    walletAddress: string | null;
  };
}

interface CompanyOption {
  id: string;
  name: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? (
        <Check className="h-3 w-3 text-foreground" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

function CreateUserSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    companyId: "",
    name: "",
    email: "",
    wallet: "",
    externalId: "",
    clerkUserId: "",
  });

  const reset = useCallback(() => {
    setForm({
      companyId: "",
      name: "",
      email: "",
      wallet: "",
      externalId: "",
      clerkUserId: "",
    });
    setError("");
  }, []);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadCompanies() {
      setLoadingCompanies(true);
      try {
        const res = await fetch("/api/v1/companies?limit=100", { cache: "no-store" });
        if (!res.ok) return;

        const data = (await res.json()) as {
          data?: Array<{ id: string; name: string }>;
        };
        if (!cancelled) {
          setCompanies(data.data?.map((company) => ({
            id: company.id,
            name: company.name,
          })) ?? []);
        }
      } finally {
        if (!cancelled) setLoadingCompanies(false);
      }
    }

    void loadCompanies();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleCreate() {
    if (!form.companyId) return;

    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/v1/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: form.companyId,
          name: form.name || undefined,
          email: form.email || undefined,
          wallet: form.wallet || undefined,
          id: form.externalId || undefined,
          clerk_user_id: form.clerkUserId || undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Failed to create user");
        return;
      }

      reset();
      onOpenChange(false);
      onCreated();
    } finally {
      setCreating(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent side="right" className="sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/60">
          <SheetTitle>Add User</SheetTitle>
          <SheetDescription>
            Users are optional in the identity graph, but helpful for tracking who triggered usage within a company.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="space-y-1.5">
            <Label>Company</Label>
            <Select
              value={form.companyId}
              onValueChange={(companyId) => setForm((current) => ({ ...current, companyId }))}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingCompanies ? "Loading companies..." : "Select company"} />
              </SelectTrigger>
              <SelectContent>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="user-name">Name</Label>
            <Input
              id="user-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Jane Doe"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="jane@acme.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="user-wallet">Wallet Address</Label>
            <Input
              id="user-wallet"
              value={form.wallet}
              onChange={(event) => setForm((current) => ({ ...current, wallet: event.target.value }))}
              placeholder="0x..."
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="user-external-id">External ID</Label>
            <Input
              id="user-external-id"
              value={form.externalId}
              onChange={(event) => setForm((current) => ({ ...current, externalId: event.target.value }))}
              placeholder="user_123"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="user-clerk-id">Clerk User ID</Label>
            <Input
              id="user-clerk-id"
              value={form.clerkUserId}
              onChange={(event) => setForm((current) => ({ ...current, clerkUserId: event.target.value }))}
              placeholder="user_2abc..."
              className="font-mono text-xs"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <SheetFooter className="px-6 py-4 border-t border-border/60 flex-row gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !form.companyId} className="flex-1">
            {creating ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Creating…
              </>
            ) : (
              "Add User"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function SubscribersSection() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/v1/users?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;

      const data = (await res.json()) as { data?: UserRecord[] };
      setUsers(data.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
            Identified end users linked to companies through identify and track events.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add User
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, email, wallet, or company…"
          className="pl-9"
        />
      </div>

      {loading ? (
        <SkeletonList items={4} />
      ) : users.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-14 text-center space-y-3">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="font-medium">{search ? "No users match your search" : "No users identified yet"}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {search
                ? "Try a different search term."
                : "Users appear here when your app sends identify or track calls with user keys like email, wallet, Clerk ID, or an internal user ID."}
            </p>
          </div>
          {!search && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> Add User
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60">
                <th className="w-[52%] px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide sm:w-[34%]">User</th>
                <th className="hidden w-[21%] px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide lg:table-cell">Email</th>
                <th className="hidden w-[12%] px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide xl:table-cell">Wallet</th>
                <th className="w-[48%] px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide lg:w-[30%] xl:w-[23%]">Company</th>
                <th className="hidden w-[18%] px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide sm:table-cell lg:w-[15%] xl:w-[10%]">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {users.map((user) => {
                const displayName = user.name || user.email || user.walletAddress || user.externalId || "Unknown";
                const identityMode = user.walletAddress ? "Wallet" : user.email ? "Email" : "Named";

                return (
                  <tr key={user.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <UserRound className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium" title={displayName}>
                              {displayName}
                            </span>
                            <Badge variant="outline" className="shrink-0 text-[11px]">
                              {identityMode}
                            </Badge>
                          </div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                            {user.clerkUserId && <span>Clerk</span>}
                            {user.externalId && (
                              <code className="truncate font-mono" title={user.externalId}>
                                {user.externalId}
                              </code>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {user.email ? (
                        <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate" title={user.email}>
                            {user.email}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      {user.walletAddress ? (
                        <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                          <Wallet className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate" title={user.walletAddress}>
                            {user.walletAddress.slice(0, 8)}…{user.walletAddress.slice(-6)}
                          </span>
                          <CopyButton text={user.walletAddress} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div
                            className="truncate text-sm font-medium text-foreground"
                            title={user.company?.name ?? "Unknown company"}
                          >
                            {user.company?.name ?? "Unknown company"}
                          </div>
                          <div
                            className="truncate text-xs text-muted-foreground"
                            title={user.company?.email ?? user.company?.walletAddress ?? user.companyId}
                          >
                            {user.company?.email ?? user.company?.walletAddress ?? user.companyId}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground">
                      {formatRelativeTime(new Date(user.lastSeenAt).getTime() / 1000)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserSheet open={showCreate} onOpenChange={setShowCreate} onCreated={fetchUsers} />
    </div>
  );
}
