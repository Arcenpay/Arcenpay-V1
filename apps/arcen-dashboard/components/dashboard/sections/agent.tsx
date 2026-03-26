"use client";

import React, { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import {
  Bot,
  Zap,
  Key,
  Activity,
  Copy,
  Check,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Terminal,
  BookOpen,
  ChevronRight,
  Shield,
  Clock,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────
interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

interface SessionRow {
  sessionId: string;
  agentAddress: string;
  balance: string;
  totalFunded: string;
  totalSettled: string;
  active: boolean;
  createdAt: string;
}

// ─────────────────────────────────────────────
//  Code Snippet Tab
// ─────────────────────────────────────────────
function CodeBlock({ code, lang = "typescript" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group rounded-lg bg-[#0d0d0d] border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-[#111]">
        <span className="text-xs text-muted-foreground font-mono">{lang}</span>
        <button onClick={copy} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-4 text-xs leading-relaxed text-green-300 font-mono overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  );
}

// ─────────────────────────────────────────────
//  API Keys Tab
// ─────────────────────────────────────────────
function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/provider/api-keys")
      .then((r) => r.json())
      .then((d) => setKeys(d.keys ?? []))
      .catch(() => setKeys([]))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/provider/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();
      if (data.key) {
        setCreatedKey(data.key);
        setKeys((prev) => [data.apiKey, ...prev]);
        setNewKeyName("");
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/provider/api-keys/${id}`, { method: "DELETE" });
    setKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const copyKey = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">API Keys</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Use these keys to authenticate your agent with ArcenPay APIs.</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
          <Plus className="w-4 h-4" />
          New Key
        </Button>
      </div>

      {/* Revealed key banner */}
      {createdKey && (
        <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <Shield className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-400">Save your key — it won't be shown again</p>
              <div className="flex items-center gap-2 mt-2">
                <code className="text-xs font-mono bg-background/50 px-2 py-1 rounded text-foreground flex-1 truncate">{createdKey}</code>
                <button onClick={() => copyKey(createdKey, "new")} className="shrink-0">
                  {copiedId === "new" ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-muted-foreground hover:text-foreground" />}
                </button>
              </div>
            </div>
            <button onClick={() => setCreatedKey(null)} className="text-muted-foreground hover:text-foreground text-xs shrink-0">✕</button>
          </div>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : keys.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-lg">
          <Key className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No API keys yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Create a key to authenticate your agent</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
          {keys.map((key) => (
            <div key={key.id} className="flex items-center gap-4 px-4 py-3 hover:bg-secondary/30 transition-colors">
              <Key className="w-4 h-4 text-muted-foreground/60 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{key.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <code className="text-xs font-mono text-muted-foreground">{key.prefix}••••••••••••••••</code>
                  {key.lastUsedAt && (
                    <span className="text-xs text-muted-foreground/60">
                      Last used {new Date(key.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => copyKey(`${key.prefix}••••`, key.id)}
                  className="p-1.5 rounded hover:bg-secondary transition-colors"
                  title="Copy prefix"
                >
                  {copiedId === key.id ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
                <button
                  onClick={() => handleDelete(key.id)}
                  className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="Revoke key"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create key dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium mb-2 block">Key Name</Label>
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Production Agent, Dev Bot"
                className="h-10"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <p className="text-xs text-muted-foreground mt-1.5">A label to identify this key</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={!newKeyName.trim() || creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Sessions Tab
// ─────────────────────────────────────────────
function SessionsTab() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/platform/sessions")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const formatUsdc = (raw: string) => {
    const n = parseFloat(raw) / 1_000_000;
    return isNaN(n) ? "—" : `$${n.toFixed(2)}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Agent Sessions</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          SessionVault sessions used for x402 pay-per-call billing.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-lg">
          <Database className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No active sessions</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Sessions are created when an agent calls fundSession()</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Session</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Balance</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Settled</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map((s) => (
                <tr key={s.sessionId} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-4 py-3">
                    <code className="text-xs font-mono text-muted-foreground">{s.sessionId.slice(0, 10)}…</code>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs font-mono text-muted-foreground">{s.agentAddress.slice(0, 8)}…{s.agentAddress.slice(-4)}</code>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatUsdc(s.balance)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{formatUsdc(s.totalSettled)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={s.active ? "default" : "secondary"} className={cn("text-xs", s.active && "bg-green-500/15 text-green-500 border-green-500/20")}>
                      {s.active ? "Active" : "Closed"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Quickstart Tab
// ─────────────────────────────────────────────
function QuickstartTab() {
  const installCode = `npm install @arcenpay/agent @arcenpay/sdk viem`;

  const nodeCode = `import { ArcenPayAgent } from "@arcenpay/agent";

const agent = new ArcenPayAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  rpcUrl: process.env.RPC_URL,          // e.g. https://mainnet.base.org
  chainId: 8453,                         // Base Mainnet
  maxAutoApprove: "0.10",               // Max $0.10 USDC per call
});

// Fund a session with $10 USDC
const sessionId = await agent.fundSession("10.00");
console.log("Session:", sessionId);

// Call a pay-per-use API — payment handled automatically
const res = await agent.fetch("https://api.yourprovider.com/v1/data");
const data = await res.json();`;

  const x402Code = `import express from "express";
import { x402Middleware } from "@arcenpay/node";

const app = express();

// Gate any route with USDC payment
app.use("/api/premium", x402Middleware({
  facilitatorUrl: process.env.ARCENPAY_FACILITATOR_URL,
  planId: 1,
  chainId: 8453,
  acceptedTokens: ["USDC"],
}));

app.get("/api/premium/analyze", (req, res) => {
  // req.arcenpay.signer = agent's wallet address
  // req.arcenpay.amount = settled amount
  res.json({ result: "premium data" });
});`;

  const envCode = `AGENT_PRIVATE_KEY=0x...
RPC_URL=https://mainnet.base.org
ARCENPAY_FACILITATOR_URL=https://facilitator.arcenpay.xyz`;

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold text-foreground">Agent Quickstart</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Build autonomous AI agents that pay for API access with USDC — no human approval.
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Bot, title: "Agent has wallet", desc: "Your AI agent holds USDC in a smart account" },
          { icon: Zap, title: "Hits x402 API", desc: "API returns HTTP 402 with payment options" },
          { icon: Check, title: "Auto-pays & retries", desc: "Agent signs EIP-712, retries with payment header" },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="p-4 rounded-lg border border-border bg-secondary/20">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center mb-3">
              <Icon className="w-4 h-4 text-accent" />
            </div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground mt-1">{desc}</p>
          </div>
        ))}
      </div>

      {/* Step 1 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-accent text-[10px] font-bold text-accent-foreground flex items-center justify-center shrink-0">1</span>
          <h4 className="text-sm font-semibold text-foreground">Install the SDK</h4>
        </div>
        <CodeBlock code={installCode} lang="bash" />
      </div>

      {/* Step 2 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-accent text-[10px] font-bold text-accent-foreground flex items-center justify-center shrink-0">2</span>
          <h4 className="text-sm font-semibold text-foreground">Set environment variables</h4>
        </div>
        <CodeBlock code={envCode} lang=".env" />
      </div>

      {/* Step 3 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-accent text-[10px] font-bold text-accent-foreground flex items-center justify-center shrink-0">3</span>
          <h4 className="text-sm font-semibold text-foreground">Create an agent and make paid API calls</h4>
        </div>
        <CodeBlock code={nodeCode} lang="typescript" />
      </div>

      {/* Step 4 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-accent text-[10px] font-bold text-accent-foreground flex items-center justify-center shrink-0">4</span>
          <h4 className="text-sm font-semibold text-foreground">Gate your API with x402 middleware</h4>
        </div>
        <CodeBlock code={x402Code} lang="typescript" />
        <p className="text-xs text-muted-foreground">
          The x402 middleware verifies payment and injects <code className="font-mono bg-secondary px-1 py-0.5 rounded text-xs">req.arcenpay</code> with the verified payment context.
        </p>
      </div>

      {/* Resources */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: BookOpen, title: "Agent SDK docs", href: "#" },
          { icon: Terminal, title: "x402 Protocol spec", href: "#" },
        ].map(({ icon: Icon, title, href }) => (
          <a key={title} href={href} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors group">
            <Icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
            <span className="text-sm text-foreground">{title}</span>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
          </a>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Main Agent Section
// ─────────────────────────────────────────────
type AgentTab = "quickstart" | "api-keys" | "sessions";

export function AgentSection() {
  const [tab, setTab] = useState<AgentTab>("quickstart");
  const { address, isConnected } = useAccount();

  const tabs: { id: AgentTab; label: string; icon: React.ElementType }[] = [
    { id: "quickstart", label: "Quickstart", icon: Zap },
    { id: "api-keys", label: "API Keys", icon: Key },
    { id: "sessions", label: "Sessions", icon: Activity },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-0 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20 border border-violet-500/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Agent</h1>
              <p className="text-xs text-muted-foreground">AI agent SDK, API keys, and session management</p>
            </div>
          </div>
          {isConnected && (
            <Badge variant="outline" className="text-xs gap-1 text-green-500 border-green-500/30 bg-green-500/5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Wallet connected
            </Badge>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px",
                tab === id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "quickstart" && <QuickstartTab />}
        {tab === "api-keys" && <ApiKeysTab />}
        {tab === "sessions" && <SessionsTab />}
      </div>
    </div>
  );
}
