"use client";

import React, { useState, useEffect } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { toast } from "sonner";
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
  Shield,
  Clock,
  Database,
  Wallet,
  ArrowRightLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DASHBOARD_DOCS_URL } from "@/lib/docs-url";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { getUsdcAddress } from "@/lib/contracts";
import { resolveEnvironmentChainId } from "@/lib/default-chain";
import { useEnvironment } from "@/contexts/environment-context";
import { SkeletonList, SkeletonTable } from "@/components/ui/skeleton";
import { useStellarWallet } from "@/hooks/use-stellar-wallet";
import {
  isStellarChainId,
  getStellarNetworkPassphrase,
} from "@arcenpay/internal-core";

const ERC20_APPROVE_ABI = [{
  type: "function",
  name: "approve",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
  stateMutability: "nonpayable",
}] as const;

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

interface SettlementRow {
  id: string;
  callCount: string;
  settlementAmount: string;
  timestamp: string;
  txHash: string;
}

interface SessionRow {
  id: string;
  agent: string;
  currentBalance: string;
  totalFunded: string;
  totalWithdrawn: string;
  totalSettled: string;
  settlements: SettlementRow[];
}

interface SessionsPayload {
  sessions?: SessionRow[];
  degraded?: boolean;
  dependencyHealth?: {
    subgraph: "ok" | "unavailable";
    facilitator: "ok" | "unavailable";
  };
}

interface ProviderConfig {
  type: string;
  label?: string;
  enabled: boolean;
  botToken?: string;
  chatId?: string;
  webhookUrl?: string;
  email?: string;
}

interface PermissionConfig {
  autoTopUp: {
    mode: "auto" | "dispatch" | "off";
    dailyLimit: string;
    perTxnLimit: string;
    threshold: string;
  };
  dispatch: {
    enabled: boolean;
    providers: ProviderConfig[];
    cooldownSeconds: number;
    maxRetries: number;
  };
}

interface DispatchRequest {
  id: string;
  agentAddress: string;
  amount: string;
  reason: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  provider: string;
  providerTarget: string;
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
          {copied ? <Check className="w-3.5 h-3.5 text-foreground" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-4 text-xs leading-relaxed text-foreground font-mono overflow-x-auto whitespace-pre">{code}</pre>
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
    fetch("/api/v1/api-keys")
      .then((r) => r.json())
      .then((d) => setKeys(d.data ?? []))
      .catch(() => {
        setKeys([]);
        toast.error("Failed to load API keys");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json() as {
        data?: { id: string; name: string; prefix: string; key: string; createdAt: string };
      };
      if (data.data?.key) {
        setCreatedKey(data.data.key);
        setKeys((prev) => [{ ...data.data!, lastUsedAt: null, expiresAt: null }, ...prev]);
        setNewKeyName("");
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/v1/api-keys?id=${id}`, { method: "DELETE" });
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
        <div className="p-4 rounded-lg border border-border bg-secondary">
          <div className="flex items-start gap-3">
            <Shield className="w-4 h-4 text-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Save your key — it won't be shown again</p>
              <div className="flex items-center gap-2 mt-2">
                <code className="text-xs font-mono bg-background/50 px-2 py-1 rounded text-foreground flex-1 truncate">{createdKey}</code>
                <button onClick={() => copyKey(createdKey, "new")} className="shrink-0">
                  {copiedId === "new" ? <Check className="w-4 h-4 text-foreground" /> : <Copy className="w-4 h-4 text-muted-foreground hover:text-foreground" />}
                </button>
              </div>
            </div>
            <button onClick={() => setCreatedKey(null)} className="text-muted-foreground hover:text-foreground text-xs shrink-0">✕</button>
          </div>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <SkeletonList items={3} />
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
                  {copiedId === key.id ? <Check className="w-3.5 h-3.5 text-foreground" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
                <button
                  onClick={() => handleDelete(key.id)}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-destructive transition-colors"
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
  const [warning, setWarning] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/platform/sessions")
      .then((r) => r.json())
      .then((d: SessionsPayload) => {
        setSessions(d.sessions ?? []);
        setWarning(
          d.degraded
            ? "Some session data is temporarily unavailable. Empty results may reflect an upstream outage."
            : null,
        );
      })
      .catch(() => {
        setSessions([]);
        setWarning("Session data is temporarily unavailable.");
      })
      .finally(() => setLoading(false));
  }, []);

  const formatUsdc = (raw: string) => {
    const n = parseFloat(raw) / 1_000_000;
    return isNaN(n) ? "—" : `$${n.toFixed(2)}`;
  };

  const formatHex = (hex: string) => `${hex.slice(0, 10)}…`;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Agent Sessions</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          SessionVault sessions used for x402 pay-per-call billing.
        </p>
      </div>
      {warning && (
        <div className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
          {warning}
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={3} cols={6} />
      ) : sessions.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-lg">
          <Database className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No active sessions</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Sessions are created when an agent calls fundSession()</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Session</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Funded</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Settled</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Withdrawn</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Balance</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
              {sessions.map((s) => (
                <React.Fragment key={s.id}>
                  <tr
                    className="hover:bg-secondary/20 transition-colors cursor-pointer"
                    onClick={() => setExpandedSession(expandedSession === s.id ? null : s.id)}
                  >
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-muted-foreground">{formatHex(s.id)}</code>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-muted-foreground">{s.agent.slice(0, 8)}…{s.agent.slice(-4)}</code>
                    </td>
                    <td className="px-4 py-3 text-right">{formatUsdc(s.totalFunded)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{formatUsdc(s.totalSettled)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{formatUsdc(s.totalWithdrawn)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatUsdc(s.currentBalance)}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={BigInt(s.currentBalance) > 0n ? "default" : "secondary"} className={cn("text-xs", BigInt(s.currentBalance) > 0n && "bg-secondary text-foreground border-border")}>
                        {BigInt(s.currentBalance) > 0n ? "Active" : "Closed"}
                      </Badge>
                    </td>
                  </tr>
                  {expandedSession === s.id && s.settlements.length > 0 && (
                    <tr className="bg-secondary/10">
                      <td colSpan={7} className="px-6 py-3">
                        <div className="text-xs text-muted-foreground font-medium mb-2">Recent Settlements</div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          {s.settlements.map((st) => (
                            <div key={st.id} className="p-2 rounded bg-background/50 border border-border/50">
                              <div className="text-muted-foreground">{formatUsdc(st.settlementAmount)}</div>
                              <div className="text-muted-foreground/60">{st.callCount} calls</div>
                              <div className="text-muted-foreground/40 font-mono text-[10px] break-all">{st.txHash.slice(0, 12)}…</div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Quickstart Tab
// ─────────────────────────────────────────────
function QuickstartTab() {
  const { envMode, activeEnvironment } = useEnvironment();
  const configuredChainId =
    activeEnvironment?.chainId ?? resolveEnvironmentChainId(envMode);
  const isStellar = isStellarChainId(configuredChainId);

  const installCode = `npm install @arcenpay/agent${isStellar ? " @stellar/stellar-sdk" : " viem"}`;

  const nodeCode = isStellar
    ? `import { ArcenPayAgent } from "@arcenpay/agent";

const agent = new ArcenPayAgent({
  privateKey: process.env.AGENT_SECRET_KEY, // S… Stellar secret key
  chainId: ${configuredChainId},            // Stellar (synthetic chain id)
  horizonUrl: process.env.HORIZON_URL,
  sorobanRpcUrl: process.env.SOROBAN_RPC_URL,
  maxAutoApprove: "0.10",                   // Max $0.10 USDC per call
});

// Fund a session with $10 USDC
const sessionId = await agent.fundSession("10.00");
console.log("Session:", sessionId);

// Call a pay-per-use API — payment handled automatically
const res = await agent.fetch("https://api.yourprovider.com/v1/data");
const data = await res.json();`
    : `import { ArcenPayAgent } from "@arcenpay/agent";

const agent = new ArcenPayAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY,
  rpcUrl: process.env.RPC_URL,          // e.g. https://mainnet.base.org
  chainId: ${configuredChainId},         // chain id for this environment
  maxAutoApprove: "0.10",               // Max $0.10 USDC per call
});

// Fund a session with $10 USDC
const sessionId = await agent.fundSession("10.00");
console.log("Session:", sessionId);

// Call a pay-per-use API — payment handled automatically
const res = await agent.fetch("https://api.yourprovider.com/v1/data");
const data = await res.json();`;

  const x402Code = isStellar
    ? `import express from "express";
import { x402Middleware } from "@arcenpay/node";

const app = express();

// Gate any route with USDC payment (Stellar)
app.use("/api/premium", x402Middleware({
  facilitatorUrl: process.env.ARCENPAY_FACILITATOR_URL,
  planId: 1,
  chainId: ${configuredChainId},   // Stellar
  acceptedTokens: ["USDC"],
}));

app.get("/api/premium/analyze", (req, res) => {
  // req.arcenpay.signer = agent's wallet address
  // req.arcenpay.amount = settled amount
  res.json({ result: "premium data" });
});`
    : `import express from "express";
import { x402Middleware } from "@arcenpay/node";

const app = express();

// Gate any route with USDC payment
app.use("/api/premium", x402Middleware({
  facilitatorUrl: process.env.ARCENPAY_FACILITATOR_URL,
  planId: 1,
  chainId: ${configuredChainId},
  acceptedTokens: ["USDC"],
}));

app.get("/api/premium/analyze", (req, res) => {
  // req.arcenpay.signer = agent's wallet address
  // req.arcenpay.amount = settled amount
  res.json({ result: "premium data" });
});`;

  const envCode = isStellar
    ? `AGENT_SECRET_KEY=S…
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
ARCENPAY_FACILITATOR_URL=https://facilitator.arcenpay.xyz`
    : `AGENT_PRIVATE_KEY=0x...
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
          { icon: Bot, title: "Agent has wallet", desc: isStellar ? "Your AI agent holds USDC in a Soroban session vault" : "Your AI agent holds USDC in a smart account" },
          { icon: Zap, title: "Hits x402 API", desc: "API returns HTTP 402 with payment options" },
          { icon: Check, title: "Auto-pays & retries", desc: isStellar ? "Agent signs a Stellar message, retries with payment header" : "Agent signs EIP-712, retries with payment header" },
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
          {
            icon: BookOpen,
            title: "Agent SDK docs",
            desc: "Open the canonical docs app for agent setup and hosted payments.",
            href: `${DASHBOARD_DOCS_URL}/sdk-reference/agent`,
          },
          {
            icon: Terminal,
            title: "x402 protocol",
            desc: "Review the current sessions and payment flow in the docs app.",
            href: `${DASHBOARD_DOCS_URL}/core-concepts/sessions`,
          },
        ].map(({ icon: Icon, title, desc, href }) => (
          <a
            key={title}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg border border-border bg-secondary/10 p-3 transition hover:border-border/80 hover:bg-secondary/20"
          >
            <Icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
            <div className="min-w-0">
              <span className="text-sm text-foreground block">{title}</span>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Permissions Tab (Auto-Topup + Dispatch)
// ─────────────────────────────────────────────
function PermissionsTab() {
  const { address: userWallet, isConnected, chainId: evmChainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { envMode, activeEnvironment } = useEnvironment();
  const configuredChainId =
    activeEnvironment?.chainId ?? resolveEnvironmentChainId(envMode);
  const isStellar = isStellarChainId(configuredChainId);
  const stellar = useStellarWallet(configuredChainId);

  const [permissions, setPermissions] = useState<PermissionConfig>({
    autoTopUp: { mode: "off", dailyLimit: "5.00", perTxnLimit: "1.00", threshold: "0.50" },
    dispatch: { enabled: false, providers: [], cooldownSeconds: 120, maxRetries: 3 },
  });
  const [agentWallet, setAgentWallet] = useState<string>("");
  const [approveAmount, setApproveAmount] = useState<string>("100");
  const [approveTxHash, setApproveTxHash] = useState<string>("");
  const [approving, setApproving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({
    type: "telegram" as string,
    label: "",
    botToken: "",
    chatId: "",
    webhookUrl: "",
    email: "",
  });
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [generatedAddress, setGeneratedAddress] = useState<string | null>(null);
  const [savingWallet, setSavingWallet] = useState(false);
  const [testingIdx, setTestingIdx] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data: approveReceipt } = useWaitForTransactionReceipt({
    hash: approveTxHash as `0x${string}` | undefined,
    // Stellar hashes are 64-hex without an 0x prefix — wagmi's receipt watcher
    // only understands EVM hashes, so disable it on Stellar (the Stellar path
    // toasts its own success).
    query: { enabled: !!approveTxHash && !isStellar },
  });

  useEffect(() => {
    if (approveReceipt) {
      toast.success(`Agent pre-approved to pull up to $${approveAmount} USDC`);
      setApproveTxHash("");
      setApproving(false);
      setApproveAmount("100");
    }
  }, [approveReceipt, approveAmount]);

  const handlePreApprove = async () => {
    if (isStellar) {
      if (!stellar.isConnected || !agentWallet) return;
      setApproving(true);
      try {
        // Stellar has no ERC-20 approve — pre-funding is a direct USDC SAC
        // transfer from the connected wallet to the agent wallet.
        const { Asset, Horizon, TransactionBuilder, Operation, BASE_FEE } =
          await import("@stellar/stellar-sdk");
        const passphrase = getStellarNetworkPassphrase(configuredChainId);
        const horizonUrl = passphrase.includes("Test")
          ? "https://horizon-testnet.stellar.org"
          : "https://horizon.stellar.org";
        const server = new Horizon.Server(horizonUrl);
        const usdcAddress = getUsdcAddress(configuredChainId);
        if (!usdcAddress) {
          throw new Error("No USDC asset configured for this chain.");
        }
        const asset = new Asset("USDC", usdcAddress);
        const payer = await server.loadAccount(stellar.address!);
        const tx = new TransactionBuilder(payer, {
          fee: BASE_FEE,
          networkPassphrase: passphrase,
        })
          .addOperation(
            Operation.payment({
              destination: agentWallet,
              asset,
              amount: approveAmount || "1",
            }),
          )
          .setTimeout(300)
          .build();
        const { signedTxXdr } = await stellar.signTransaction(tx.toXDR(), {
          networkPassphrase: passphrase,
          address: stellar.address!,
        });
        const signedTx = TransactionBuilder.fromXDR(signedTxXdr, passphrase);
        const submitted = await server.submitTransaction(signedTx);
        setApproveTxHash(submitted.hash);
        toast.info("Transfer submitted...");
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Transfer failed");
        setApproving(false);
      }
      return;
    }

    if (!isConnected || !agentWallet || !evmChainId) return;
    setApproving(true);
    try {
      const usdcAddress = getUsdcAddress(evmChainId);
      const amountAtomic = parseUnits(approveAmount || "0", 6);
      const hash = await writeContractAsync({
        address: usdcAddress as `0x${string}`,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [agentWallet as `0x${string}`, amountAtomic],
      });
      setApproveTxHash(hash);
      toast.info("Transaction submitted...");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Transaction failed");
      setApproving(false);
    }
  };

  const handleGenerateWallet = async () => {
    if (isStellar) {
      // Stellar: ed25519 keypair. Public key is the G… address; the secret
      // (S…) is what ArcenAgent uses as `privateKey`.
      const { Keypair } = await import("@stellar/stellar-sdk");
      const kp = Keypair.random();
      setGeneratedKey(kp.secret());
      setGeneratedAddress(kp.publicKey());
      return;
    }
    const pk = generatePrivateKey();
    const addr = privateKeyToAddress(pk);
    setGeneratedKey(pk);
    setGeneratedAddress(addr);
  };

  const handleSaveWallet = async () => {
    if (!generatedAddress) return;
    setSavingWallet(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/v1/agent/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoTopUp: permissions.autoTopUp,
          dispatch: permissions.dispatch,
          chainId: configuredChainId,
          agentWalletAddress: generatedAddress,
        }),
      });
      if (!res.ok) {
        let errMsg = `Server returned ${res.status}`;
        try {
          const err = await res.json();
          if (err.error) errMsg = err.error;
        } catch { /* use status */ }
        setSaveError(`Failed to save wallet: ${errMsg}`);
        return;
      }
      setAgentWallet(generatedAddress);
      setGeneratedKey(null);
      setGeneratedAddress(null);
      toast.success("Agent wallet created! Copy your private key now — it won't be shown again.");
    } catch (e: any) {
      setSaveError(`Network error: ${e.message || "check console"}`);
    } finally {
      setSavingWallet(false);
    }
  };

  useEffect(() => {
    fetch("/api/v1/agent/permissions")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d.data) {
          setPermissions({
            autoTopUp: d.data.autoTopUp || permissions.autoTopUp,
            dispatch: d.data.dispatch || permissions.dispatch,
          });
          if (d.data.agentWalletAddress) {
            setAgentWallet(d.data.agentWalletAddress);
          }
        }
      })
      .catch(() => {
        toast.error("Failed to load agent settings");
      })
      .finally(() => setLoading(false));
  }, []);

  const savePermissions = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const res = await fetch("/api/v1/agent/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoTopUp: permissions.autoTopUp,
          dispatch: permissions.dispatch,
          chainId: configuredChainId,
          agentWalletAddress: agentWallet || undefined,
        }),
      });
      if (!res.ok) {
        let errMsg = `Server returned ${res.status}`;
        try {
          const err = await res.json();
          if (err.error) errMsg = err.error;
        } catch {
          const text = await res.text().catch(() => "");
          if (text.includes("<!DOCTYPE") || text.includes("<html")) {
            errMsg = `Auth required (${res.status}). Make sure you are logged in.`;
          } else if (text) {
            errMsg = `Server error ${res.status}: ${text.slice(0, 200)}`;
          }
        }
        setSaveError(errMsg);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      if (e.message?.includes("Failed to fetch") || e.name === "TypeError") {
        setSaveError("Network error — check your connection or if a wallet extension is blocking requests.");
      } else {
        setSaveError(e.message || "An unexpected error occurred");
      }
    } finally {
      setSaving(false);
    }
  };

  const testDispatchProvider = async (providerIndex: number) => {
    const provider = permissions.dispatch.providers[providerIndex];
    if (!provider) return;
    setTestingIdx(providerIndex);
    setTestResult(null);
    try {
      const res = await fetch("/api/v1/agent/dispatch/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      let msg = "";
      try {
        const data = await res.json();
        msg = data.message || "";
      } catch {
        const text = await res.text().catch(() => "");
        msg = text.includes("<html") ? `Auth error (${res.status})` : `Server error ${res.status}`;
      }
      setTestResult({ ok: res.ok, message: msg || (res.ok ? "Test sent!" : "Test failed") });
    } catch (e: any) {
      if (e.message?.includes("Failed to fetch")) {
        setTestResult({ ok: false, message: "Network error — check your connection or if a wallet extension is blocking requests." });
      } else {
        setTestResult({ ok: false, message: e.message || "Network error" });
      }
    } finally {
      setTestingIdx(null);
    }
  };

  const addProvider = () => {
    const p = newProvider;
    const valid =
      (p.type === "telegram" && p.botToken.trim() && p.chatId.trim()) ||
      ((p.type === "discord" || p.type === "slack") && p.webhookUrl.trim()) ||
      (p.type === "email" && p.email.trim());
    if (!valid) return;

    const provider: ProviderConfig = {
      type: p.type,
      label: p.label.trim() || undefined,
      enabled: true,
    };
    if (p.type === "telegram") {
      provider.botToken = p.botToken.trim();
      provider.chatId = p.chatId.trim();
    } else if (p.type === "discord" || p.type === "slack") {
      provider.webhookUrl = p.webhookUrl.trim();
    } else if (p.type === "email") {
      provider.email = p.email.trim();
    }

    setPermissions({
      ...permissions,
      dispatch: {
        ...permissions.dispatch,
        providers: [...permissions.dispatch.providers, provider],
      },
    });
    setNewProvider({ type: "telegram", label: "", botToken: "", chatId: "", webhookUrl: "", email: "" });
    setShowAddProvider(false);
  };

  const removeProvider = (index: number) => {
    setPermissions({
      ...permissions,
      dispatch: {
        ...permissions.dispatch,
        providers: permissions.dispatch.providers.filter((_, i) => i !== index),
      },
    });
  };

  const toggleProviderEnabled = (index: number) => {
    const providers = [...permissions.dispatch.providers];
    providers[index] = { ...providers[index], enabled: !providers[index].enabled };
    setPermissions({
      ...permissions,
      dispatch: { ...permissions.dispatch, providers },
    });
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h3 className="text-base font-semibold text-foreground">Agent Permissions</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Control how your agent handles top-ups and payment approvals.
        </p>
      </div>

      {/* Agent Wallet */}
      <div className="space-y-4 p-5 rounded-lg border border-border bg-secondary">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-foreground" />
          <h4 className="text-sm font-semibold text-foreground">Step 1: Create Agent Wallet</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          {isStellar
            ? "Your agent needs its own Stellar wallet to sign payments and hold USDC. This is separate from your connected wallet for security."
            : "Your agent needs its own Ethereum wallet to sign payments and hold USDC. This is separate from your connected wallet for security."}
        </p>

        {agentWallet ? (
          <div className="flex items-center gap-3 p-3 rounded border border-border bg-secondary">
            <Wallet className="w-4 h-4 text-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Agent Wallet Active</p>
              <code className="text-xs font-mono text-foreground block truncate">{agentWallet}</code>
            </div>
            <Badge variant="outline" className="text-xs text-foreground border-border bg-secondary shrink-0">
              Active
            </Badge>
          </div>
        ) : generatedAddress ? (
          <div className="space-y-3">
            <div className="p-4 rounded-lg border border-border bg-secondary">
              <div className="flex items-start gap-3">
                <Shield className="w-4 h-4 text-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-sm font-medium text-foreground">Save your private key — it won&apos;t be shown again</p>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Address</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono bg-background/50 px-2 py-1 rounded text-foreground flex-1 truncate">{generatedAddress}</code>
                      <button onClick={() => { navigator.clipboard.writeText(generatedAddress); toast.success("Copied"); }} className="shrink-0">
                        <Copy className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Private Key</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono bg-background/50 px-2 py-1 rounded text-foreground flex-1 truncate">{generatedKey}</code>
                      <button onClick={() => { navigator.clipboard.writeText(generatedKey!); toast.success("Copied"); }} className="shrink-0">
                        <Copy className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={handleSaveWallet} disabled={savingWallet}>
                      {savingWallet ? "Saving…" : "Save Wallet Address"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setGeneratedKey(null); setGeneratedAddress(null); }}>
                      Cancel
                    </Button>
                  </div>
                  {saveError && <p className="text-xs text-foreground">{saveError}</p>}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 border border-dashed border-border rounded-lg">
            <Wallet className="w-8 h-8 text-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No agent wallet yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1 mb-3">Generate one to get started — your agent needs it to sign payments</p>
            <Button onClick={handleGenerateWallet} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              Generate Agent Wallet
            </Button>
          </div>
        )}
      </div>

      {!agentWallet && (
        <div className="text-center py-8 text-xs text-muted-foreground">
          Create your agent wallet above to unlock auto-topup, dispatch, and pre-approve settings.
        </div>
      )}

      {agentWallet && (
      <>
      {/* Auto-Topup Mode */}
      <div className="space-y-4 p-5 rounded-lg border border-border bg-secondary/10">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Auto-Topup</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Automatically refill your agent's session when balance is low</p>
          </div>
          <select
            value={permissions.autoTopUp.mode}
            onChange={(e) => setPermissions({ ...permissions, autoTopUp: { ...permissions.autoTopUp, mode: e.target.value as "auto" | "dispatch" | "off" } })}
            className="text-sm bg-background border border-border rounded px-3 py-1.5 text-foreground"
          >
            <option value="off">Off</option>
            <option value="auto">Auto (no approval)</option>
            <option value="dispatch">Dispatch (approve via msg)</option>
          </select>
        </div>

        {permissions.autoTopUp.mode !== "off" && (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Daily Limit</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={permissions.autoTopUp.dailyLimit}
                  onChange={(e) => setPermissions({ ...permissions, autoTopUp: { ...permissions.autoTopUp, dailyLimit: e.target.value } })}
                  className="pl-7 h-9 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Per Txn Limit</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={permissions.autoTopUp.perTxnLimit}
                  onChange={(e) => setPermissions({ ...permissions, autoTopUp: { ...permissions.autoTopUp, perTxnLimit: e.target.value } })}
                  className="pl-7 h-9 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Threshold</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={permissions.autoTopUp.threshold}
                  onChange={(e) => setPermissions({ ...permissions, autoTopUp: { ...permissions.autoTopUp, threshold: e.target.value } })}
                  className="pl-7 h-9 text-sm"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pre-Approve Agent Wallet */}
      <div className="space-y-4 p-5 rounded-lg border border-border bg-secondary/10">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Step 2: Pre-Approve Agent</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isStellar
              ? `Fund your agent wallet (${agentWallet.slice(0, 4)}…) with USDC from your connected wallet. Required once.`
              : `Authorize your agent wallet (${agentWallet.slice(0, 8)}…) to pull USDC from your connected wallet. Required once.`}
          </p>
        </div>
        <div className="flex items-end gap-4">
          <div className="w-40">
            <Label className="text-xs text-muted-foreground mb-1.5 block">Spending Limit (USDC)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                step="10"
                min="1"
                value={approveAmount}
                onChange={(e) => setApproveAmount(e.target.value)}
                className="pl-7 h-9 text-sm"
              />
            </div>
          </div>
          {isStellar ? (
            stellar.isConnected && stellar.address ? (
              <Button
                onClick={handlePreApprove}
                disabled={!approveAmount || approving || !!approveTxHash}
                className="gap-1.5"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                {approving || approveTxHash ? "Transferring…" : `Transfer $${approveAmount} USDC`}
              </Button>
            ) : (
              <Button onClick={() => void stellar.connect()} className="gap-1.5">
                <Wallet className="w-3.5 h-3.5" />
                Connect Stellar wallet
              </Button>
            )
          ) : isConnected && userWallet ? (
            <Button
              onClick={handlePreApprove}
              disabled={!approveAmount || approving || !!approveTxHash}
              className="gap-1.5"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              {approving || approveTxHash ? "Approving…" : `Approve $${approveAmount} USDC`}
            </Button>
          ) : (
            <p className="text-xs text-foreground pb-1">Connect your wallet to approve</p>
          )}
        </div>
        {isStellar ? (
          stellar.isConnected && (
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>From: {stellar.address?.slice(0, 4)}…{stellar.address?.slice(-4)}</span>
              <span>→</span>
              <span>To: {agentWallet.slice(0, 4)}…{agentWallet.slice(-4)}</span>
            </div>
          )
        ) : isConnected ? (
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>From: {userWallet?.slice(0, 8)}…{userWallet?.slice(-4)}</span>
            <span>→</span>
            <span>To: {agentWallet.slice(0, 8)}…{agentWallet.slice(-4)}</span>
          </div>
        ) : null}
      </div>

      {/* Dispatch Providers */}
      <div className="space-y-4 p-5 rounded-lg border border-border bg-secondary/10">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Dispatch Providers</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Connect messaging apps to receive and approve top-up requests. Each provider carries its own credentials.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowAddProvider(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Add Provider
          </Button>
        </div>

        {permissions.dispatch.providers.length === 0 ? (
          <div className="text-center py-6 border border-dashed border-border rounded-lg">
            <p className="text-sm text-muted-foreground">No dispatch providers connected</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Click Add Provider to connect Telegram, Discord, Slack, or Email</p>
          </div>
        ) : (
          <div className="space-y-2">
            {permissions.dispatch.providers.map((p, i) => {
              const detail =
                p.type === "telegram" ? `Bot: ${(p.botToken || "").slice(0, 12)}… | Chat: ${p.chatId}` :
                p.type === "discord" || p.type === "slack" ? (p.webhookUrl || "").slice(0, 40) + "…" :
                p.email || "";
              return (
                <div key={i} className="flex items-center justify-between gap-3 p-3 rounded border border-border bg-background/50">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground uppercase shrink-0">
                      {p.type.slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.label || p.type}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{detail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleProviderEnabled(i)}
                      className={cn(
                        "w-8 h-5 rounded-full transition-colors relative",
                        p.enabled ? "bg-green-500" : "bg-muted"
                      )}
                    >
                      <span className={cn(
                        "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                        p.enabled ? "left-[14px]" : "left-[2px]"
                      )} />
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => testDispatchProvider(i)}
                      disabled={testingIdx === i}
                      className="h-7 text-xs"
                    >
                      {testingIdx === i ? "Sending…" : "Test"}
                    </Button>
                    <button onClick={() => removeProvider(i)} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            {testResult && (
              <div className={cn(
                "text-xs px-3 py-2 rounded",
                testResult.ok ? "bg-secondary text-foreground border border-border" : "bg-secondary text-foreground border border-border"
              )}>
                {testResult.message}
              </div>
            )}
          </div>
        )}

        {/* Dispatch settings */}
        {permissions.dispatch.providers.length > 0 && (
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Cooldown (seconds)</Label>
              <Input
                type="number"
                min="30"
                value={permissions.dispatch.cooldownSeconds}
                onChange={(e) => setPermissions({
                  ...permissions,
                  dispatch: { ...permissions.dispatch, cooldownSeconds: parseInt(e.target.value) || 120 }
                })}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Max Retries</Label>
              <Input
                type="number"
                min="1"
                max="10"
                value={permissions.dispatch.maxRetries}
                onChange={(e) => setPermissions({
                  ...permissions,
                  dispatch: { ...permissions.dispatch, maxRetries: parseInt(e.target.value) || 3 }
                })}
                className="h-9 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={savePermissions} disabled={saving || loading}>
          {loading ? "Loading…" : saving ? "Saving…" : saved ? "Saved ✓" : "Save Permissions"}
        </Button>
        {saved && <span className="text-xs text-foreground">Settings saved</span>}
        {saveError && <span className="text-xs text-foreground">{saveError}</span>}
      </div>

      {/* Add Provider Dialog */}
      <Dialog open={showAddProvider} onOpenChange={setShowAddProvider}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Dispatch Provider</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium mb-2 block">Provider Type</Label>
              <select
                value={newProvider.type}
                onChange={(e) => setNewProvider({ type: e.target.value, label: "", botToken: "", chatId: "", webhookUrl: "", email: "" })}
                className="w-full text-sm bg-background border border-border rounded px-3 py-2 text-foreground"
              >
                <option value="telegram">Telegram</option>
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="email">Email</option>
              </select>
            </div>

            {newProvider.type === "telegram" && (
              <>
                <div>
                  <Label className="text-sm font-medium mb-2 block">Bot Token</Label>
                  <Input
                    type="password"
                    value={newProvider.botToken}
                    onChange={(e) => setNewProvider({ ...newProvider, botToken: e.target.value })}
                    placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                    className="h-10 text-sm font-mono"
                  />
                  <p className="text-xs text-muted-foreground mt-1">From @BotFather on Telegram</p>
                </div>
                <div>
                  <Label className="text-sm font-medium mb-2 block">Chat ID</Label>
                  <Input
                    value={newProvider.chatId}
                    onChange={(e) => setNewProvider({ ...newProvider, chatId: e.target.value })}
                    placeholder="e.g. 123456789"
                    className="h-10 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Your Telegram user or group chat ID</p>
                </div>
              </>
            )}

            {(newProvider.type === "discord" || newProvider.type === "slack") && (
              <div>
                <Label className="text-sm font-medium mb-2 block">Webhook URL</Label>
                <Input
                  value={newProvider.webhookUrl}
                  onChange={(e) => setNewProvider({ ...newProvider, webhookUrl: e.target.value })}
                  placeholder="https://hooks.provider.com/services/..."
                  className="h-10 text-sm font-mono"
                />
              </div>
            )}

            {newProvider.type === "email" && (
              <div>
                <Label className="text-sm font-medium mb-2 block">Email Address</Label>
                <Input
                  value={newProvider.email}
                  onChange={(e) => setNewProvider({ ...newProvider, email: e.target.value })}
                  placeholder="alerts@example.com"
                  className="h-10 text-sm"
                  type="email"
                />
              </div>
            )}

            <div>
              <Label className="text-sm font-medium mb-2 block">Label (optional)</Label>
              <Input
                value={newProvider.label}
                onChange={(e) => setNewProvider({ ...newProvider, label: e.target.value })}
                placeholder="e.g. My Telegram Bot"
                className="h-10"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAddProvider(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={addProvider}
              disabled={
                (newProvider.type === "telegram" && (!newProvider.botToken.trim() || !newProvider.chatId.trim())) ||
                ((newProvider.type === "discord" || newProvider.type === "slack") && !newProvider.webhookUrl.trim()) ||
                (newProvider.type === "email" && !newProvider.email.trim())
              }
            >
              Add Provider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Dispatch History Tab
// ─────────────────────────────────────────────
function DispatchHistoryTab() {
  const [requests, setRequests] = useState<DispatchRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/agent/dispatch")
      .then((r) => r.json())
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => {
        setRequests([]);
        toast.error("Failed to load dispatch history");
      })
      .finally(() => setLoading(false));
  }, []);

  const formatUsdc = (raw: string) => {
    const n = parseFloat(raw) / 1_000_000;
    return isNaN(n) ? "—" : `$${n.toFixed(2)}`;
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, { color: string; label: string }> = {
      pending: { color: "bg-secondary text-foreground border-border", label: "Pending" },
      approved: { color: "bg-secondary text-foreground border-border", label: "Approved" },
      denied: { color: "bg-secondary text-foreground border-border", label: "Denied" },
      expired: { color: "bg-muted text-muted-foreground border-border", label: "Expired" },
    };
    const v = variants[status] ?? variants.expired;
    return <Badge className={cn("text-xs", v.color)}>{v.label}</Badge>;
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Dispatch History</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          History of top-up approval requests sent via dispatch providers.
        </p>
      </div>

      {loading ? (
        <SkeletonTable rows={3} cols={5} />
      ) : requests.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-lg">
          <Clock className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No dispatch requests yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Requests appear when your agent triggers a dispatch top-up</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Time</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Provider</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reason</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {requests.map((r) => (
                <tr key={r.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatUsdc(r.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-muted-foreground capitalize">{r.provider}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground max-w-[200px] truncate block">{r.reason}</span>
                  </td>
                  <td className="px-4 py-3 text-center">{statusBadge(r.status)}</td>
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
//  Main Agent Section
// ─────────────────────────────────────────────
type AgentTab = "quickstart" | "api-keys" | "sessions" | "permissions" | "dispatch";

export function AgentSection() {
  const [tab, setTab] = useState<AgentTab>("quickstart");
  const { address, isConnected } = useAccount();
  const { envMode, activeEnvironment } = useEnvironment();
  const agentSectionChainId =
    activeEnvironment?.chainId ?? resolveEnvironmentChainId(envMode);
  const isStellar = isStellarChainId(agentSectionChainId);
  const stellar = useStellarWallet(agentSectionChainId);
  // Family-aware connection for the header badge: wagmi's isConnected is
  // meaningless on a Stellar environment.
  const walletConnected = isStellar ? stellar.isConnected : isConnected;

  const tabs: { id: AgentTab; label: string; icon: LucideIcon }[] = [
    { id: "quickstart", label: "Quickstart", icon: Zap },
    { id: "api-keys", label: "API Keys", icon: Key },
    { id: "sessions", label: "Sessions", icon: Activity },
    { id: "permissions", label: "Permissions", icon: Shield },
    { id: "dispatch", label: "Dispatch", icon: Clock },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-0 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20 border border-border flex items-center justify-center">
              <Bot className="w-4 h-4 text-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Arcen Agent</h1>
              <p className="text-xs text-muted-foreground">ArcenPay agent SDK, API keys, session management, auto-topup & dispatch</p>
            </div>
          </div>
          {walletConnected && (
            <Badge variant="outline" className="text-xs gap-1 text-foreground border-border bg-secondary">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Wallet connected
            </Badge>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 flex-wrap">
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
        {tab === "permissions" && <PermissionsTab />}
        {tab === "dispatch" && <DispatchHistoryTab />}
      </div>
    </div>
  );
}
