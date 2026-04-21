"use client";

import { useState, useEffect, useCallback } from "react";
import { Key, Plus, Trash2, Copy, Check, AlertTriangle, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { formatRelativeTime } from "@/lib/format";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  description: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface NewKeyResult {
  id: string;
  name: string;
  prefix: string;
  key: string;
  createdAt: string;
}

function CopyableKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2 font-mono text-xs">
      <span className="flex-1 overflow-hidden text-ellipsis">
        {visible ? value : "api_" + "•".repeat(24) + value.slice(-8)}
      </span>
      <button onClick={() => setVisible(!visible)} className="text-muted-foreground hover:text-foreground">
        {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
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
  const [createForm, setCreateForm] = useState({ name: "", description: "" });
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/api-keys");
      if (res.ok) {
        const data = await res.json() as { data: ApiKey[] };
        setKeys(data.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createForm.name, description: createForm.description || undefined }),
      });
      if (res.ok) {
        const data = await res.json() as { data: NewKeyResult };
        setNewKey(data.data);
        setShowCreate(false);
        setCreateForm({ name: "", description: "" });
        fetchKeys();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/v1/api-keys?id=${id}`, { method: "DELETE" });
      fetchKeys();
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
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-green-600 dark:text-green-400 text-sm">
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
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="h-11 bg-muted/50 border-b border-border" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50">
              <div className="h-4 w-32 bg-muted/50 animate-pulse rounded" />
              <div className="h-4 w-20 bg-muted/50 animate-pulse rounded" />
              <div className="h-4 w-16 bg-muted/50 animate-pulse rounded ml-auto" />
            </div>
          ))}
        </div>
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
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
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
                    <div className="font-medium text-sm">{k.name}</div>
                    {k.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">{k.description}</div>
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
                      disabled={deletingId === k.id}
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
Authorization: Bearer api_xxx
X-Arcen-Company-Keys: wallet=0x...`}
        </pre>
      </div>

      {/* Create Sheet */}
      <Sheet open={showCreate} onOpenChange={(v) => { if (!v) { setShowCreate(false); setCreateForm({ name: "", description: "" }); } }}>
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

            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>The full key is shown only once after creation. Store it somewhere safe immediately.</span>
            </div>
          </div>

          <SheetFooter className="px-6 py-4 border-t border-border/60 flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setShowCreate(false); setCreateForm({ name: "", description: "" }); }}>
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
