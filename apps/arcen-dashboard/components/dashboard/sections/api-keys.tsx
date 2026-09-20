"use client";
import { apiFetch } from "@/lib/api-client";

import { useState, useEffect, useCallback } from "react";
import { Key, Plus, Trash2, Copy, Check, AlertTriangle, Eye, EyeOff, ShieldCheck } from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { SkeletonTable } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import { toast } from "sonner";

/**
 * Turns a failed API response into a human-readable message.
 *
 * SECURITY/UX: the backend already returns actionable, non-sensitive reasons
 * (PROTOCOL_ACTIVATION_REQUIRED, LIMIT_REACHED, "No workspace environment
 * selected"). Surfacing them is what stops "I clicked Create and nothing
 * happened" from looking like a fake/mock feature.
 */
async function describeApiError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: string;
      message?: string;
      code?: string;
    };
    const detail = body?.message || body?.error || body?.code;
    if (detail) return String(detail);
  } catch {
    // fall through to the status-based message
  }
  if (res.status === 401) return "Your session expired. Please sign in again.";
  if (res.status === 403) return "You do not have permission to manage API keys (OWNER or ADMIN required).";
  if (res.status === 409) return "Workspace is not ready for API keys yet (check the active environment and activation key).";
  return `Request failed (HTTP ${res.status}).`;
}

type ApiKeyType = "SECRET" | "PUBLISHABLE" | "RESTRICTED";

const KEY_TYPE_OPTIONS: Array<{ value: ApiKeyType; label: string; hint: string }> = [
  { value: "SECRET", label: "Secret key", hint: "sk_live_/sk_test_ — server-side (Node SDK). Full access." },
  { value: "PUBLISHABLE", label: "Publishable key", hint: "pk_live_/pk_test_ — safe in the browser (React SDK). Read-only." },
  { value: "RESTRICTED", label: "Restricted key", hint: "rk_live_/rk_test_ — server-side with limited permissions." },
];

const PERMISSION_OPTIONS = [
  "entitlements.read",
  "usage.consume",
  "customers.read",
  "companies.write",
  "payments.write",
  "subscriptions.write",
  "tokens.create",
  "invoices.read",
  "invoices.write",
  "invoices.send",
] as const;

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  description: string | null;
  type?: ApiKeyType;
  permissions?: string[];
  environmentMode?: "DEVELOPMENT" | "PRODUCTION";
  expiresAt?: string | null;
  revokedAt?: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface NewKeyResult {
  id: string;
  name: string;
  prefix: string;
  key: string;
  type: ApiKeyType;
  environmentMode: string;
  expiresAt: string | null;
  createdAt: string;
}

interface CreateForm {
  name: string;
  description: string;
  type: ApiKeyType;
  permissions: string[];
  expiresInDays: string;
}

function typeBadge(type?: ApiKeyType) {
  if (type === "PUBLISHABLE") return { label: "Publishable", cls: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300" };
  if (type === "RESTRICTED") return { label: "Restricted", cls: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300" };
  return { label: "Secret", cls: "border-foreground/15 bg-secondary text-foreground/80" };
}

function envBadge(mode?: string) {
  if (mode === "PRODUCTION") return { label: "live", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" };
  return { label: "test", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300" };
}

function CopyableKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2 font-mono text-xs">
      <span className="flex-1 overflow-hidden text-ellipsis">
        {visible ? value : value.slice(0, Math.min(12, value.indexOf("_") + 4)) + "•".repeat(22) + value.slice(-8)}
      </span>
      <button onClick={() => setVisible(!visible)} className="text-muted-foreground hover:text-foreground">
        {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="h-3 w-3 text-foreground" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

/** Embeddable panel — no page header. Use inside Settings tabs. */
export function ProtocolKeysPanel() {
  return <ApiKeysContent />;
}

function ApiKeysContent() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({
    name: "",
    description: "",
    type: "SECRET",
    permissions: [],
    expiresInDays: "",
  });
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/v1/api-keys");
      if (res.ok) {
        const data = await res.json() as { data: ApiKey[] };
        setKeys(data.data);
      } else {
        // Previously silent: an unactivated/unauthorised workspace showed an
        // empty list with no explanation.
        toast.error(await describeApiError(res));
      }
    } catch {
      toast.error("Could not reach the API. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name,
          description: createForm.description || undefined,
          type: createForm.type,
          permissions: createForm.type === "PUBLISHABLE" ? [] : createForm.permissions,
          expiresInDays: createForm.expiresInDays ? Number(createForm.expiresInDays) : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { data: NewKeyResult };
        // Guard against a response shape change silently rendering an empty key.
        if (!data?.data?.key) {
          toast.error("The API returned no key material. No key was created — please retry.");
          return;
        }
        setNewKey(data.data);
        setShowCreate(false);
        setCreateForm({ name: "", description: "", type: "SECRET", permissions: [], expiresInDays: "" });
        toast.success(`API key created: ${data.data.prefix}…`);
        fetchKeys();
      } else {
        // THE key fix: this branch used to be missing entirely, so every
        // failure (403 activation required, 409 limit reached, 401 session,
        // 500) closed the sheet abruptly with zero feedback.
        toast.error(await describeApiError(res));
      }
    } catch {
      toast.error("Could not reach the API while creating the key. Nothing was created.");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await apiFetch(`/api/v1/api-keys?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("API key revoked.");
        fetchKeys();
      } else {
        toast.error(await describeApiError(res));
      }
    } catch {
      toast.error("Could not reach the API while revoking the key.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" /> Create API Key
        </Button>
      </div>

      {/* New key banner */}
      {newKey && (
        <div className="rounded-lg border border-border bg-secondary p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-foreground flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground dark:text-foreground text-sm">
                Key created: <strong>{newKey.name}</strong>
              </p>
              <p className="text-muted-foreground text-xs mt-1 mb-3">
                Copy this key now — it will never be shown again.
              </p>
              <CopyableKey value={newKey.key} />
            </div>
            <button onClick={() => setNewKey(null)} className="text-muted-foreground hover:text-foreground text-xs">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <SkeletonTable rows={3} cols={5} />
      ) : keys.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-14 text-center">
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <Key className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="font-medium text-sm mb-1">No API keys yet</p>
          <p className="text-muted-foreground text-xs">Create a key to authenticate requests to the protocol API.</p>
          <Button size="sm" className="mt-4" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Create API Key
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Key Prefix</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Last Used</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Created</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {keys.map((k) => (
                <tr key={k.id} className="group hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {k.name}
                      {k.revokedAt && <Badge variant="destructive" className="text-[10px]">Revoked</Badge>}
                    </div>
                    {k.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">{k.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className={`text-[10px] ${typeBadge(k.type).cls}`}>
                        {typeBadge(k.type).label}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${envBadge(k.environmentMode).cls}`}>
                        {envBadge(k.environmentMode).label}
                      </Badge>
                    </div>
                    {k.permissions && k.permissions.length > 0 && (
                      <div className="text-[10px] text-muted-foreground mt-1 font-mono">
                        {k.permissions.length} permission{k.permissions.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge variant="outline" className="font-mono text-xs">{k.prefix}•••</Badge>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-muted-foreground hidden md:table-cell">
                    {k.lastUsedAt ? formatRelativeTime(new Date(k.lastUsedAt).getTime() / 1000) : "Never"}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-muted-foreground hidden lg:table-cell">
                    {formatRelativeTime(new Date(k.createdAt).getTime() / 1000)}
                  </td>
                  <td className="px-4 py-3.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDelete(k.id)}
                      disabled={deletingId === k.id || Boolean(k.revokedAt)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Usage example */}
      <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Usage</p>
        <pre className="text-xs text-muted-foreground overflow-x-auto leading-relaxed">
{`GET /api/v1/flags/check?key=scan
Authorization: Bearer sk_test_xxx        (or pk_test_xxx for browser reads)
X-Arcen-Company-Keys: wallet=0x...`}
        </pre>
      </div>

      {/* Create Sheet */}
      <Sheet open={showCreate} onOpenChange={(v) => { if (!v) { setShowCreate(false); setCreateForm({ name: "", description: "", type: "SECRET", permissions: [], expiresInDays: "" }); } }}>
        <SheetContent side="right" className="sm:max-w-md flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/60">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="h-4 w-4 text-primary" />
              </div>
              <div>
                <SheetTitle className="text-base">Create API Key</SheetTitle>
                <SheetDescription className="text-xs mt-0.5">
                  Keys authenticate requests to the protocol API. Store securely.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="key-name"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="Production API Key"
                maxLength={64}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-desc">Description <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <Input
                id="key-desc"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="Used by our main backend service"
                maxLength={256}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Key type</Label>
              <Select
                value={createForm.type}
                onValueChange={(value) =>
                  setCreateForm({
                    ...createForm,
                    type: value as ApiKeyType,
                    permissions: value === "PUBLISHABLE" ? [] : createForm.permissions,
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Key type" />
                </SelectTrigger>
                <SelectContent>
                  {KEY_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {KEY_TYPE_OPTIONS.find((o) => o.value === createForm.type)?.hint}
              </p>
            </div>

            {createForm.type !== "PUBLISHABLE" && (
              <div className="space-y-2">
                <Label>
                  Permissions
                  <span className="text-muted-foreground text-xs font-normal">
                    {" "}{createForm.type === "SECRET" ? "(empty = full access)" : "(required)"}
                  </span>
                </Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {PERMISSION_OPTIONS.map((permission) => {
                    const checked = createForm.permissions.includes(permission);
                    return (
                      <label key={permission} className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-zinc-900"
                          checked={checked}
                          onChange={() =>
                            setCreateForm({
                              ...createForm,
                              permissions: checked
                                ? createForm.permissions.filter((p) => p !== permission)
                                : [...createForm.permissions, permission],
                            })
                          }
                        />
                        <span className="font-mono">{permission}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="key-expiry">Expires in (days) <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <Input
                id="key-expiry"
                type="number"
                min={1}
                max={365}
                value={createForm.expiresInDays}
                onChange={(e) => setCreateForm({ ...createForm, expiresInDays: e.target.value })}
                placeholder="Never expires"
              />
            </div>

            <div className="rounded-lg border border-border bg-secondary p-3 text-xs text-warning flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>The full key is shown only once after creation. Store it somewhere safe immediately.</span>
            </div>
          </div>

          <SheetFooter className="px-6 py-4 border-t border-border/60 flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setShowCreate(false); setCreateForm({ name: "", description: "", type: "SECRET", permissions: [], expiresInDays: "" }); }}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleCreate} disabled={creating || !createForm.name.trim()}>
              {creating ? "Creating..." : "Create Key"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
