"use client";

import { useState, useEffect, useCallback } from "react";
import { Key, Plus, Trash2, Copy, Check, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

/** Full-page section with header (legacy export kept for backward compat) */
export function ApiKeysSection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage API keys for external access to the ArcenPay protocol.
          </p>
        </div>
      </div>
      <ApiKeysContent />
    </div>
  );
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
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-green-800 dark:text-green-300 text-sm">
                API key created: <strong>{newKey.name}</strong>
              </p>
              <p className="text-green-700 dark:text-green-400 text-xs mt-1 mb-3">
                Copy this key now — it will never be shown again.
              </p>
              <CopyableKey value={newKey.key} />
            </div>
            <button onClick={() => setNewKey(null)} className="text-green-600 hover:text-green-800 text-xs">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : keys.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Key className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No API keys yet. Create one to start using the protocol API.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Key</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Used</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-border/50">
                  <td className="px-4 py-3">
                    <div>
                      <div className="font-medium">{k.name}</div>
                      {k.description && (
                        <div className="text-xs text-muted-foreground">{k.description}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="font-mono text-xs">{k.prefix}...</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {k.lastUsedAt ? formatRelativeTime(new Date(k.lastUsedAt).getTime() / 1000) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatRelativeTime(new Date(k.createdAt).getTime() / 1000)}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive h-7"
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
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">Usage:</p>
        <pre className="text-xs text-muted-foreground overflow-x-auto">
{`GET /api/v1/flags/check?key=scan
Authorization: Bearer api_xxx
X-Arcen-Company-Keys: wallet=0x...`}
        </pre>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg border border-border p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Create API Key</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name *</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="Production API Key"
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <input
                  type="text"
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="Used by our main backend service"
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={creating || !createForm.name.trim()}>
                {creating ? "Creating..." : "Create Key"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
