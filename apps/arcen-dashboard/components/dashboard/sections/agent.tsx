"use client";
import { apiFetch } from "@/lib/api-client";

import React, { useCallback, useRef, useState, useEffect } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { parseUnits, decodeEventLog, getAddress, isAddress } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { toast } from "sonner";
import {
  Bot,
  Zap,
  Key,
  Activity,
  Copy,
  Check,
  CheckCircle2,
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
  ArrowUpRight,
  RotateCcw,
  Loader2,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
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
import { SessionVaultABI, getContractAddresses, getUsdcAddress } from "@/lib/contracts";
import { getChainLabel, resolveEnvironmentChainId } from "@/lib/default-chain";
import { useEnvironment } from "@/contexts/environment-context";
import { SkeletonList, SkeletonTable } from "@/components/ui/skeleton";
import { useStellarWallet } from "@/hooks/use-stellar-wallet";
import { useSolanaWallet } from "@/hooks/use-solana-wallet";
import { encodeBase58 } from "@/lib/solana";
import {
  isStellarChainId,
  isSolanaChainId,
  getSolanaRpcUrl,
  getStellarNetworkPassphrase,
  getChainDescriptor,
} from "@arcenpay/internal-core";

const ERC20_BALANCE_ABI = [{
  type: "function",
  name: "balanceOf",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
  stateMutability: "view",
}] as const;

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

const ERC20_TRANSFER_ABI = [{
  type: "function",
  name: "transfer",
  inputs: [
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
  stateMutability: "nonpayable",
}] as const;

const ERC20_ALLOWANCE_ABI = [{
  type: "function",
  name: "allowance",
  inputs: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
  ],
  outputs: [{ name: "", type: "uint256" }],
  stateMutability: "view",
}] as const;

function getExplorerTxUrl(chainId: number | null | undefined, hash: string): string {
  if (!chainId) return `https://explorer?tx=${hash}`;
  const descriptor = getChainDescriptor(chainId);
  if (descriptor?.blockExplorerUrl) {
    return `${descriptor.blockExplorerUrl}/tx/${hash}`;
  }
  return `https://explorer?tx=${hash}`;
}

function safeAddress(address: string | undefined | null): `0x${string}` | null {
  if (!address || typeof address !== "string") return null;
  const trimmed = address.trim();
  if (!isAddress(trimmed, { strict: false })) return null;
  try {
    return getAddress(trimmed.toLowerCase()) as `0x${string}`;
  } catch {
    return null;
  }
}

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
    apiFetch("/api/v1/api-keys")
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
      const res = await apiFetch("/api/v1/api-keys", {
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
    await apiFetch(`/api/v1/api-keys?id=${id}`, { method: "DELETE" });
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
    apiFetch("/api/platform/sessions")
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
  const isStellar = Boolean(configuredChainId && isStellarChainId(configuredChainId));
  const isSolana = Boolean(configuredChainId && isSolanaChainId(configuredChainId));

  const installCode = `npm install @arcenpay/agent${
    isStellar ? " @stellar/stellar-sdk" : isSolana ? " @solana/web3.js" : " viem"
  }`;

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
    : isSolana
      ? `import { ArcenPayAgent } from "@arcenpay/agent";

const agent = new ArcenPayAgent({
  privateKey: process.env.AGENT_SECRET_KEY, // base58 or JSON-array Solana secret
  chainId: ${configuredChainId},            // Solana (synthetic chain id)
  rpcUrl: process.env.SOLANA_RPC_URL,
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
    : isSolana
      ? `AGENT_SECRET_KEY=<base58 or JSON-array secret>
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
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
          { icon: Bot, title: "Agent has wallet", desc: isStellar ? "Your AI agent holds USDC in a Soroban session vault" : isSolana ? "Your AI agent holds USDC in an SPL session vault" : "Your AI agent holds USDC in a smart account" },
          { icon: Zap, title: "Hits x402 API", desc: "API returns HTTP 402 with payment options" },
          { icon: Check, title: "Auto-pays & retries", desc: isStellar ? "Agent signs a Stellar message, retries with payment header" : isSolana ? "Agent signs an ed25519 message, retries with payment header" : "Agent signs EIP-712, retries with payment header" },
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
  const isStellar = Boolean(configuredChainId && isStellarChainId(configuredChainId));
  const isSolana = Boolean(configuredChainId && isSolanaChainId(configuredChainId));
  const isNonEvm = isStellar || isSolana;
  const stellar = useStellarWallet(configuredChainId ?? undefined);
  const solana = useSolanaWallet(configuredChainId ?? undefined);

  const [permissions, setPermissions] = useState<PermissionConfig>({
    autoTopUp: { mode: "off", dailyLimit: "5.00", perTxnLimit: "1.00", threshold: "0.50" },
    dispatch: { enabled: false, providers: [], cooldownSeconds: 120, maxRetries: 3 },
  });
  const [agentWalletAddress, setAgentWalletAddress] = useState<string>("");
  const [approveAmount, setApproveAmount] = useState<string>("10");
  const [fundingMode, setFundingMode] = useState<"direct" | "vault">("direct");
  const [approveHash, setApproveHash] = useState<`0x${string}` | null>(null);
  const [fundHash, setFundHash] = useState<`0x${string}` | null>(null);
  const [directHash, setDirectHash] = useState<`0x${string}` | null>(null);
  const [approveStep, setApproveStep] = useState<"approve" | "fund" | null>(null);
  const [vaultAllowance, setVaultAllowance] = useState<bigint | null>(null);
  const [checkingAllowance, setCheckingAllowance] = useState(false);
  const [agentWallets, setAgentWallets] = useState<Record<string, string>>({});
  const [preApprovals, setPreApprovals] = useState<Array<{ amount: string; txHash: string; chainId: number; mode: string; createdAt: string; sessionId?: string | null }>>([]);
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

  const [userWalletBalance, setUserWalletBalance] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [vaultBalance, setVaultBalance] = useState<string | null>(null);
  const [totalBalance, setTotalBalance] = useState<string | null>(null);
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [lastFundedSuccess, setLastFundedSuccess] = useState<{
    amount: string;
    mode: "transfer" | "approve_and_fund";
    txHash?: string;
  } | null>(null);
  const [showOtherWallets, setShowOtherWallets] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const publicClient = usePublicClient();
  const { switchChainAsync, isPending: isSwitchingNetwork } = useSwitchChain();

  // Active-chain agent wallet: per-chain map wins, legacy field falls back.
  // Normalized with safeAddress for EVM to guarantee EIP-55 checksum compliance.
  const rawAgentWallet =
    (agentWallets && agentWallets[String(configuredChainId)]) || agentWalletAddress || "";
  const agentWallet = (isStellar || isSolana)
    ? rawAgentWallet
    : (safeAddress(rawAgentWallet) ?? rawAgentWallet);

  // EVM funding must happen on the same chain the environment targets. This is
  // meaningless for non-EVM families (Stellar/Solana have no wagmi chain), so
  // they are excluded — otherwise a Solana env compares the EVM wallet's chain
  // against the Solana chain id and offers an impossible "switch".
  const chainMismatch =
    !isStellar &&
    !isSolana &&
    typeof evmChainId === "number" &&
    typeof configuredChainId === "number" &&
    evmChainId !== configuredChainId;

  const evmVaultAddress = (() => {
    if (isStellar || isSolana || typeof evmChainId !== "number") return "";
    try {
      const raw = getContractAddresses(evmChainId).sessionVault || "";
      return safeAddress(raw) ?? raw;
    } catch {
      return "";
    }
  })();

  const checkAllowance = useCallback(async () => {
    if (!userWallet || !evmChainId || !evmVaultAddress || isStellar) return;
    const safeUser = safeAddress(userWallet);
    const safeVault = safeAddress(evmVaultAddress);
    const rawUsdc = getUsdcAddress(evmChainId);
    const safeUsdc = safeAddress(rawUsdc);
    if (!safeUser || !safeVault || !safeUsdc) return;

    try {
      setCheckingAllowance(true);
      let allowance: bigint | null = null;
      if (publicClient) {
        try {
          allowance = (await publicClient.readContract({
            address: safeUsdc,
            abi: ERC20_ALLOWANCE_ABI,
            functionName: "allowance",
            args: [safeUser, safeVault],
          })) as bigint;
        } catch {}
      }

      if (allowance === null) {
        const { createPublicClient: makeClient, http: makeHttp } = await import("viem");
        const desc = getChainDescriptor(evmChainId);
        const rpc = desc?.rpcUrl || (evmChainId === 5042002 ? "https://rpc.testnet.arc.network" : "https://rpc.testnet.arc.network");
        const directClient = makeClient({ transport: makeHttp(rpc, { timeout: 15_000 }) });
        allowance = (await directClient.readContract({
          address: safeUsdc,
          abi: ERC20_ALLOWANCE_ABI,
          functionName: "allowance",
          args: [safeUser, safeVault],
        })) as bigint;
      }

      setVaultAllowance(allowance);
    } catch (err) {
      console.warn("[Agent] Allowance check failed:", err);
      setVaultAllowance(null);
    } finally {
      setCheckingAllowance(false);
    }
  }, [publicClient, userWallet, evmChainId, evmVaultAddress, isStellar]);

  // Ref to always read the latest preApprovals without stale closure issues
  const preApprovalsRef = useRef(preApprovals);
  useEffect(() => { preApprovalsRef.current = preApprovals; }, [preApprovals]);

  const refreshAgentBalance = useCallback(async (
    overrideWallet?: string,
    overridePreApprovals?: typeof preApprovals,
  ) => {
    setRefreshingBalance(true);
    // Use override values (from permissions load) or fall back to current state
    const effectiveAgentWallet = overrideWallet ?? agentWallet;
    const effectivePreApprovals = overridePreApprovals ?? preApprovalsRef.current;

    try {
      const userParam = isStellar
        ? (stellar.address ? `&userAddress=${encodeURIComponent(stellar.address)}` : "")
        : isSolana
          ? (solana.address ? `&userAddress=${encodeURIComponent(solana.address)}` : "")
          : (userWallet ? `&userAddress=${encodeURIComponent(userWallet)}` : "");

      // 1. Fetch from backend /api/v1/agent/balance
      const agentParam = effectiveAgentWallet
        ? `&agentAddress=${encodeURIComponent(effectiveAgentWallet)}`
        : "";
      const res = await apiFetch(
        `/api/v1/agent/balance?chainId=${configuredChainId}${userParam}${agentParam}`
      ).catch(() => null);
      if (res && res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.data) {
          const u = body.data.userWalletBalanceUsdc ?? "0.00";
          const w = body.data.walletBalanceUsdc ?? "0.00";
          const v = body.data.vaultBalanceUsdc ?? "0.00";
          const t = body.data.totalUsdc ?? (parseFloat(w) + parseFloat(v)).toFixed(2);
          setUserWalletBalance(u);
          setWalletBalance(w);
          setVaultBalance(v);
          setTotalBalance(t);
          if (Array.isArray(body.data.preApprovals) && body.data.preApprovals.length > 0) {
            setPreApprovals(body.data.preApprovals);
          }
          return;
        }
      }

      // 2. Direct on-chain fallback for EVM
      if (!isStellar && !isSolana && publicClient && configuredChainId) {
        const safeAgent = safeAddress(effectiveAgentWallet);
        const safeUser = safeAddress(userWallet);
        const rawUsdc = getUsdcAddress(configuredChainId);
        const safeUsdc = safeAddress(rawUsdc);
        const contracts = getContractAddresses(configuredChainId);
        const safeVault = safeAddress(contracts.sessionVault);
        const desc = getChainDescriptor(configuredChainId);
        const isNativeUsdc = desc?.nativeCurrencySymbol === "USDC";

        let uBal = 0n;
        let wBal = 0n;
        let vBal = 0n;

        // User wallet balance
        if (safeUser && safeUsdc) {
          try {
            uBal = (await publicClient.readContract({
              address: safeUsdc,
              abi: ERC20_BALANCE_ABI,
              functionName: "balanceOf",
              args: [safeUser],
            })) as bigint;
          } catch {}
          if (uBal === 0n && isNativeUsdc) {
            try {
              const nativeBal = await publicClient.getBalance({ address: safeUser });
              if (nativeBal > 0n) {
                uBal = nativeBal / 10n**12n;
              }
            } catch {}
          }
        }

        // Agent direct wallet balance
        if (safeAgent && safeUsdc) {
          try {
            wBal = (await publicClient.readContract({
              address: safeUsdc,
              abi: ERC20_BALANCE_ABI,
              functionName: "balanceOf",
              args: [safeAgent],
            })) as bigint;
          } catch {}
          if (wBal === 0n && isNativeUsdc) {
            try {
              const nativeBal = await publicClient.getBalance({ address: safeAgent });
              if (nativeBal > 0n) {
                wBal = nativeBal / 10n**12n;
              }
            } catch {}
          }
        }

        // Session vault balance (multi-source: safeAgent, safeUser, sessionIds)
        if (safeVault) {
          if (safeAgent) {
            try {
              const b = (await publicClient.readContract({
                address: safeVault,
                abi: SessionVaultABI,
                functionName: "getAgentBalance",
                args: [safeAgent],
              })) as bigint;
              if (b > vBal) vBal = b;
            } catch {}
          }

          if (safeUser) {
            try {
              const b = (await publicClient.readContract({
                address: safeVault,
                abi: SessionVaultABI,
                functionName: "getAgentBalance",
                args: [safeUser],
              })) as bigint;
              if (b > vBal) vBal = b;
            } catch {}
          }

          if (Array.isArray(effectivePreApprovals)) {
            let sessionSum = 0n;
            for (const pa of effectivePreApprovals) {
              const sId = typeof pa.sessionId === "string" ? pa.sessionId : null;
              if (sId && sId.startsWith("0x") && sId.length === 66) {
                try {
                  const sBal = (await publicClient.readContract({
                    address: safeVault,
                    abi: SessionVaultABI,
                    functionName: "getBalance",
                    args: [sId as `0x${string}`],
                  })) as bigint;
                  if (sBal > 0n) sessionSum += sBal;
                } catch {}
              }
            }
            if (sessionSum > vBal) vBal = sessionSum;
          }
        }

        let uStr = (Number(uBal) / 1e6).toFixed(2);
        let wStr = (Number(wBal) / 1e6).toFixed(2);
        let vStr = (Number(vBal) / 1e6).toFixed(2);

        // Fallback to recorded preApprovals if on-chain returns 0
        if (parseFloat(vStr) <= 0 && Array.isArray(effectivePreApprovals)) {
          const preVault = effectivePreApprovals
            .filter((p: any) => p.mode === "approve_and_fund" && Number(p.amount) > 0)
            .reduce((sum: number, p: any) => sum + Number(p.amount), 0);
          if (preVault > 0) vStr = preVault.toFixed(2);
        }

        if (parseFloat(wStr) <= 0 && Array.isArray(effectivePreApprovals)) {
          const preTransfer = effectivePreApprovals
            .filter((p: any) => p.mode === "transfer" && Number(p.amount) > 0)
            .reduce((sum: number, p: any) => sum + Number(p.amount), 0);
          if (preTransfer > 0) wStr = preTransfer.toFixed(2);
        }

        const tStr = (parseFloat(wStr) + parseFloat(vStr)).toFixed(2);

        setUserWalletBalance(uStr);
        setWalletBalance(wStr);
        setVaultBalance(vStr);
        setTotalBalance(tStr);
      } else if (isStellar && configuredChainId) {
        try {
          const { Horizon } = await import("@stellar/stellar-sdk");
          const passphrase = getStellarNetworkPassphrase(configuredChainId);
          const horizonUrl = passphrase.includes("Test")
            ? "https://horizon-testnet.stellar.org"
            : "https://horizon.stellar.org";
          const server = new Horizon.Server(horizonUrl);

          if (stellar.address) {
            try {
              const uAcc = await server.loadAccount(stellar.address);
              const uLine = uAcc.balances.find((b: any) => b.asset_code === "USDC");
              if (uLine && "balance" in uLine) {
                setUserWalletBalance(parseFloat(uLine.balance).toFixed(2));
              }
            } catch {}
          }

          if (effectiveAgentWallet) {
            try {
              const aAcc = await server.loadAccount(effectiveAgentWallet);
              const aLine = aAcc.balances.find((b: any) => b.asset_code === "USDC");
              if (aLine && "balance" in aLine) {
                const w = parseFloat(aLine.balance).toFixed(2);
                setWalletBalance(w);
                setTotalBalance(w);
              }
            } catch {}
          }
        } catch (e) {
          console.warn("[getAgentBalance Stellar client]", e);
        }
      }
    } catch (err) {
      console.warn("[Agent] Failed to refresh balances:", err);
    } finally {
      setRefreshingBalance(false);
    }
  }, [agentWallet, configuredChainId, isStellar, isSolana, publicClient, userWallet, stellar.address, solana.address]);

  // ── Manual receipt polling (bypasses wagmi's broken polling on slow RPCs) ──
  // wagmi's useWaitForTransactionReceipt uses a short internal timeout per poll
  // which silently fails on slow RPCs like Arc Testnet. We instead use
  // publicClient.waitForTransactionReceipt with a 120s timeout + 8s poll interval.

  const [isWaitingDirect, setIsWaitingDirect] = useState(false);
  const [isDirectSuccess, setIsDirectSuccess] = useState(false);

  const [isWaitingApprove, setIsWaitingApprove] = useState(false);
  const [isApproveSuccess, setIsApproveSuccess] = useState(false);

  const [isWaitingFund, setIsWaitingFund] = useState(false);
  const [isFundSuccess, setIsFundSuccess] = useState(false);
  const [fundReceipt, setFundReceipt] = useState<{ logs: readonly { address: `0x${string}`; data: `0x${string}`; topics: readonly `0x${string}`[] }[] } | null>(null);

  // Poll receipt directly — creates its own viem client with 30s transport timeout
  // so we bypass wagmi's internal transport and poll fast and reliably.
  const pollReceipt = useCallback(async (
    hash: `0x${string}`,
    onSuccess: (receipt: { logs: readonly { address: `0x${string}`; data: `0x${string}`; topics: readonly `0x${string}`[] }[] }) => void,
    onFail: () => void,
  ) => {
    const { createPublicClient: makeClient, http: makeHttp } = await import("viem");
    const desc = configuredChainId ? getChainDescriptor(configuredChainId) : null;
    const primaryRpc = desc?.rpcUrl || (configuredChainId === 5042002 ? "https://rpc.testnet.arc.network" : "https://rpc.testnet.arc.network");
    const fallbackRpc = configuredChainId === 5042002 ? "https://5042002.rpc.thirdweb.com" : primaryRpc;

    const directClient = makeClient({
      transport: makeHttp(primaryRpc, { timeout: 15_000 }),
    });
    const fallbackClient = makeClient({
      transport: makeHttp(fallbackRpc, { timeout: 15_000 }),
    });

    const MAX_ATTEMPTS = 50; // 50 × 2.5s = 125 seconds (~2 minutes)
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        let receipt = await directClient.getTransactionReceipt({ hash }).catch(() => null);
        if (!receipt && fallbackRpc !== primaryRpc) {
          receipt = await fallbackClient.getTransactionReceipt({ hash }).catch(() => null);
        }
        if (receipt) {
          if (receipt.status === "success") {
            onSuccess(receipt);
          } else {
            onFail();
          }
          return;
        }
      } catch {
        // receipt not indexed or confirmed yet — keep polling
      }
      await new Promise((res) => setTimeout(res, 2_500));
    }
    console.warn("[Agent] Receipt polling timed out for", hash);
    onFail();
  }, [configuredChainId]);


  useEffect(() => {
    if (!directHash) { setIsWaitingDirect(false); setIsDirectSuccess(false); return; }
    setIsWaitingDirect(true);
    setIsDirectSuccess(false);
    void pollReceipt(
      directHash,
      () => { setIsWaitingDirect(false); setIsDirectSuccess(true); },
      () => { setIsWaitingDirect(false); setIsDirectSuccess(false); },
    );
  }, [directHash, pollReceipt]);

  useEffect(() => {
    if (!approveHash) { setIsWaitingApprove(false); setIsApproveSuccess(false); return; }
    setIsWaitingApprove(true);
    setIsApproveSuccess(false);
    void pollReceipt(
      approveHash,
      () => { setIsWaitingApprove(false); setIsApproveSuccess(true); },
      () => { setIsWaitingApprove(false); setIsApproveSuccess(false); },
    );
  }, [approveHash, pollReceipt]);

  useEffect(() => {
    if (!fundHash) { setIsWaitingFund(false); setIsFundSuccess(false); setFundReceipt(null); return; }
    setIsWaitingFund(true);
    setIsFundSuccess(false);
    void pollReceipt(
      fundHash,
      (receipt) => { setIsWaitingFund(false); setIsFundSuccess(true); setFundReceipt(receipt); },
      () => { setIsWaitingFund(false); setIsFundSuccess(false); },
    );
  }, [fundHash, pollReceipt]);

  useEffect(() => {
    void checkAllowance();
  }, [checkAllowance]);

  // Only refresh when the connected wallet changes after initial load
  // (not on mount — the permissions load triggers the first refresh with correct data)
  const prevUserWalletRef = useRef<string | undefined>(undefined);
  const prevStellarAddressRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const currentUser = isStellar
      ? stellar.address
      : isSolana
        ? solana.address
        : userWallet;
    const prevUser = isStellar ? prevStellarAddressRef.current : prevUserWalletRef.current;
    if (currentUser && currentUser !== prevUser) {
      if (isStellar) {
        prevStellarAddressRef.current = stellar.address ?? undefined;
      } else {
        prevUserWalletRef.current = userWallet;
      }
      // Only refresh if we already have an agent wallet loaded (avoids double-fire on mount)
      if (agentWallet) {
        void refreshAgentBalance();
      }
    }
  }, [userWallet, stellar.address, agentWallet, isStellar, refreshAgentBalance]);

  const recordApproval = useCallback(
    async (input: {
      amount: string;
      txHash: string;
      chainId: number;
      mode: "approve_and_fund" | "transfer";
      sessionId?: string | null;
    }) => {
      try {
        const res = await apiFetch("/api/v1/agent/fund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(body?.data?.preApprovals)) {
          setPreApprovals(body.data.preApprovals);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [],
  );

  const handleResetApproval = () => {
    setApproving(false);
    setApproveStep(null);
    setApproveHash(null);
    setFundHash(null);
    setDirectHash(null);
    void checkAllowance();
  };

  // Handle direct transfer confirmed
  useEffect(() => {
    if (isDirectSuccess && directHash) {
      const amount = approveAmount || "0";
      toast.success(`Agent wallet successfully funded with $${amount} USDC!`);
      setLastFundedSuccess({
        amount,
        mode: "transfer",
        txHash: directHash,
      });
      void recordApproval({
        amount,
        txHash: directHash,
        chainId: (evmChainId || configuredChainId) ?? 0,
        mode: "transfer",
      }).then(() => {
        void refreshAgentBalance();
      });
      setDirectHash(null);
      void checkAllowance();
    }
  }, [isDirectSuccess, directHash, approveAmount, evmChainId, configuredChainId, recordApproval, checkAllowance, refreshAgentBalance]);

  // Handle vault approval confirmed
  useEffect(() => {
    if (isApproveSuccess && approveHash) {
      toast.success("USDC approval confirmed on-chain! Click 'Step 2: Deposit into Vault' to complete funding.");
      setApproveStep("fund");
      void checkAllowance();
    }
  }, [isApproveSuccess, approveHash, checkAllowance]);

  // Handle vault deposit confirmed
  useEffect(() => {
    if (isFundSuccess && fundHash && fundReceipt) {
      let extractedSessionId: string | null = null;
      for (const log of fundReceipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: SessionVaultABI,
            data: log.data,
            topics: log.topics as [`0x${string}`, ...`0x${string}`[]] | [],
          });
          if (decoded.eventName === "SessionFunded") {
            extractedSessionId = (decoded.args as any).sessionId;
            break;
          }
        } catch {}
      }
      const amount = approveAmount || "0";
      setLastFundedSuccess({
        amount,
        mode: "approve_and_fund",
        txHash: fundHash,
      });
      void recordApproval({
        amount,
        txHash: fundHash,
        chainId: (evmChainId || configuredChainId) ?? 0,
        mode: "approve_and_fund",
        sessionId: extractedSessionId,
      }).then(() => {
        void refreshAgentBalance();
      });
      toast.success(`Session vault funded with $${amount} USDC!`);
      setApproveHash(null);
      setFundHash(null);
      setApproveStep(null);
      void checkAllowance();
    }
  }, [isFundSuccess, fundHash, fundReceipt, approveAmount, evmChainId, configuredChainId, recordApproval, checkAllowance, refreshAgentBalance]);

  const handleDirectTransfer = async () => {
    if (isStellar || isSolana) {
      return handlePreApprove();
    }
    if (chainMismatch) {
      toast.error(`Your wallet is on network ${evmChainId}; switch to ${configuredChainId} before funding.`);
      return;
    }
    if (!isConnected || !userWallet || !agentWallet || !evmChainId) return;

    const safeRecipient = safeAddress(agentWallet);
    if (!safeRecipient) {
      toast.error(`Agent wallet address "${agentWallet}" is invalid. Please generate or enter a valid address.`);
      return;
    }

    const rawUsdc = getUsdcAddress(evmChainId);
    const safeUsdc = safeAddress(rawUsdc);
    if (!safeUsdc) {
      toast.error(`No valid USDC token address configured for chain ${evmChainId}`);
      return;
    }

    const amountAtomic = parseUnits(approveAmount || "0", 6);
    if (amountAtomic <= 0n) {
      toast.error("Please enter a valid amount greater than 0");
      return;
    }

    setApproving(true);
    try {
      toast.info("Please confirm the USDC transfer in your wallet…");
      const hash = await writeContractAsync({
        address: safeUsdc,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [safeRecipient, amountAtomic],
      });
      setDirectHash(hash as `0x${string}`);
      toast.info("Transfer submitted! Waiting for block confirmation…");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Direct transfer failed");
    } finally {
      setApproving(false);
    }
  };

  const handleVaultApprove = async () => {
    if (chainMismatch) {
      toast.error(`Your wallet is on network ${evmChainId}; switch to ${configuredChainId} before funding.`);
      return;
    }
    if (!isConnected || !userWallet || !evmChainId) return;

    const rawUsdc = getUsdcAddress(evmChainId);
    const safeUsdc = safeAddress(rawUsdc);
    const safeVault = safeAddress(getContractAddresses(evmChainId).sessionVault);
    if (!safeUsdc || !safeVault) {
      toast.error("Session vault or USDC address is invalid for this chain");
      return;
    }

    const amountAtomic = parseUnits(approveAmount || "0", 6);
    if (amountAtomic <= 0n) {
      toast.error("Please enter a valid amount greater than 0");
      return;
    }

    setApproving(true);
    setApproveStep("approve");
    try {
      toast.info("Please confirm USDC approval in your wallet…");
      const hash = await writeContractAsync({
        address: safeUsdc,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [safeVault, amountAtomic],
      });
      setApproveHash(hash as `0x${string}`);
      toast.info("Approval submitted! Waiting for block confirmation…");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Approval failed");
      setApproveStep(null);
    } finally {
      setApproving(false);
    }
  };

  const handleVaultDeposit = async () => {
    if (chainMismatch) {
      toast.error(`Your wallet is on network ${evmChainId}; switch to ${configuredChainId} before funding.`);
      return;
    }
    if (!isConnected || !userWallet || !evmChainId) return;

    const rawUsdc = getUsdcAddress(evmChainId);
    const safeUsdc = safeAddress(rawUsdc);
    const safeVault = safeAddress(getContractAddresses(evmChainId).sessionVault);
    if (!safeUsdc || !safeVault) {
      toast.error("Session vault or USDC address is invalid for this chain");
      return;
    }

    const amountAtomic = parseUnits(approveAmount || "0", 6);
    if (amountAtomic <= 0n) {
      toast.error("Please enter a valid amount greater than 0");
      return;
    }

    setApproving(true);
    setApproveStep("fund");
    try {
      toast.info("Please confirm Session Vault deposit in your wallet…");
      const hash = await writeContractAsync({
        address: safeVault,
        abi: SessionVaultABI,
        functionName: "fundSession",
        args: [amountAtomic, safeUsdc],
      });
      setFundHash(hash as `0x${string}`);
      toast.info("Vault deposit submitted! Waiting for block confirmation…");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Vault funding failed");
    } finally {
      setApproving(false);
    }
  };

  const handleStellarTransfer = async () => {
    if (!stellar.isConnected || !stellar.address || !agentWallet || !configuredChainId) return;
    setApproving(true);
    try {
      const { Asset, Horizon, TransactionBuilder, Operation, BASE_FEE, Keypair } =
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

      // Step 1: Check if destination agent wallet exists on ledger
      let destinationExists = true;
      try {
        await server.loadAccount(agentWallet);
      } catch (e: any) {
        if (e?.response?.status === 404) {
          destinationExists = false;
        }
      }

      if (!destinationExists) {
        if (passphrase.includes("Test")) {
          toast.info("Activating agent wallet on Stellar testnet via Friendbot…");
          const fbRes = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(agentWallet)}`);
          if (!fbRes.ok) {
            throw new Error("Failed to activate agent wallet via Friendbot");
          }
          await new Promise((r) => setTimeout(r, 1500));
        } else {
          toast.info("Activating agent wallet on Stellar mainnet…");
          const payer = await server.loadAccount(stellar.address);
          const createTx = new TransactionBuilder(payer, {
            fee: BASE_FEE,
            networkPassphrase: passphrase,
          })
            .addOperation(Operation.createAccount({ destination: agentWallet, startingBalance: "2.5" }))
            .setTimeout(300)
            .build();
          const { signedTxXdr } = await stellar.signTransaction(createTx.toXDR(), {
            networkPassphrase: passphrase,
            address: stellar.address,
          });
          const signed = TransactionBuilder.fromXDR(signedTxXdr, passphrase);
          await server.submitTransaction(signed);
        }
      }

      // Step 2: Establish USDC trustline if private key is in memory
      if (generatedKey) {
        try {
          const agentKp = Keypair.fromSecret(generatedKey);
          const agentAcc = await server.loadAccount(agentWallet);
          const hasTrustline = agentAcc.balances.some(
            (b: any) => b.asset_code === "USDC" && b.asset_issuer === usdcAddress,
          );
          if (!hasTrustline) {
            toast.info("Establishing USDC trustline for agent wallet…");
            const trustTx = new TransactionBuilder(agentAcc, {
              fee: BASE_FEE,
              networkPassphrase: passphrase,
            })
              .addOperation(Operation.changeTrust({ asset }))
              .setTimeout(300)
              .build();
            trustTx.sign(agentKp);
            await server.submitTransaction(trustTx);
          }
        } catch (trustErr) {
          console.warn("Trustline auto-setup note:", trustErr);
        }
      }

      // Step 3: Execute USDC payment to agent wallet
      toast.info(`Transferring ${approveAmount || "1"} USDC to agent…`);
      const payer = await server.loadAccount(stellar.address);
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
        address: stellar.address,
      });
      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, passphrase);
      const submitted = await server.submitTransaction(signedTx);
      await recordApproval({
        amount: approveAmount || "1",
        txHash: submitted.hash,
        chainId: configuredChainId,
        mode: "transfer",
      });
      setLastFundedSuccess({
        amount: approveAmount || "1",
        mode: "transfer",
        txHash: submitted.hash,
      });
      void refreshAgentBalance();
      toast.success(`Agent wallet funded with ${approveAmount || "1"} USDC!`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Stellar transfer failed");
    } finally {
      setApproving(false);
    }
  };

  const handleSolanaTransfer = async () => {
    if (!solana.address || !configuredChainId) {
      toast.error(!configuredChainId ? "No network configured" : "Connect your Solana wallet first");
      return;
    }
    setApproving(true);
    try {
      const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } =
        await import("@solana/web3.js");
      const rpcUrl = getSolanaRpcUrl(configuredChainId);
      if (!rpcUrl) throw new Error("No Solana RPC URL configured for this environment.");
      const connection = new Connection(rpcUrl, "confirmed");

      const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
      const deriveAta = (
        owner: InstanceType<typeof PublicKey>,
        mintKey: InstanceType<typeof PublicKey>,
      ) =>
        PublicKey.findProgramAddressSync(
          [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mintKey.toBuffer()],
          ATA_PROGRAM,
        )[0];

      const mint = new PublicKey(getUsdcAddress(configuredChainId));
      const payer = new PublicKey(solana.address);
      const destination = new PublicKey(agentWallet);
      const payerAta = deriveAta(payer, mint);
      const destAta = deriveAta(destination, mint);

      const instructions: InstanceType<typeof TransactionInstruction>[] = [];
      if (!(await connection.getAccountInfo(destAta))) {
        instructions.push(
          new TransactionInstruction({
            programId: ATA_PROGRAM,
            keys: [
              { pubkey: payer, isSigner: true, isWritable: true },
              { pubkey: destAta, isSigner: false, isWritable: true },
              { pubkey: destination, isSigner: false, isWritable: false },
              { pubkey: mint, isSigner: false, isWritable: false },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
            ],
            data: new Uint8Array([1]) as unknown as Buffer,
          }),
        );
      }

      const amountAtomic = BigInt(
        Math.round(parseFloat(approveAmount || "1") * 1_000_000),
      );
      const data = new Uint8Array(10);
      data[0] = 12; // SPL TransferChecked
      new DataView(data.buffer).setBigUint64(1, amountAtomic, true);
      data[9] = 6;
      instructions.push(
        new TransactionInstruction({
          programId: TOKEN_PROGRAM,
          keys: [
            { pubkey: payerAta, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: destAta, isSigner: false, isWritable: true },
            { pubkey: payer, isSigner: true, isWritable: false },
          ],
          data: data as unknown as Buffer,
        }),
      );

      const tx = new Transaction().add(...instructions);
      tx.feePayer = payer;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      const hash = await solana.sendTransaction(tx, rpcUrl);

      await recordApproval({
        amount: approveAmount || "1",
        txHash: hash,
        chainId: configuredChainId,
        mode: "transfer",
      });
      setLastFundedSuccess({
        amount: approveAmount || "1",
        mode: "transfer",
        txHash: hash,
      });
      void refreshAgentBalance();
      toast.success(`Agent wallet funded with ${approveAmount || "1"} USDC!`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Solana transfer failed");
    } finally {
      setApproving(false);
    }
  };

  const handlePreApprove = async () => {
    if (isStellar) {
      await handleStellarTransfer();
      return;
    }
    if (isSolana) {
      await handleSolanaTransfer();
      return;
    }
    if (fundingMode === "direct") {
      await handleDirectTransfer();
    } else {
      const amountAtomic = parseUnits(approveAmount || "0", 6);
      if (vaultAllowance !== null && vaultAllowance >= amountAtomic) {
        await handleVaultDeposit();
      } else {
        await handleVaultApprove();
      }
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
    if (isSolana) {
      // Solana: ed25519 keypair. Public key is the base58 address; the base58
      // secret key is what ArcenAgent uses as `privateKey`
      // (parseSolanaSecretKey accepts base58 or a JSON byte array).
      const { Keypair: SolanaKeypair } = await import("@solana/web3.js");
      const kp = SolanaKeypair.generate();
      setGeneratedKey(encodeBase58(kp.secretKey));
      setGeneratedAddress(kp.publicKey.toBase58());
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
      const cleanAddress = isNonEvm ? generatedAddress : (safeAddress(generatedAddress) ?? generatedAddress);
      const res = await apiFetch("/api/v1/agent/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoTopUp: permissions.autoTopUp,
          dispatch: permissions.dispatch,
          chainId: configuredChainId,
          agentWalletAddress: cleanAddress,
          agentWallets: { [String(configuredChainId)]: cleanAddress },
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
      setAgentWalletAddress(cleanAddress);
      setAgentWallets((prev) => ({
        ...prev,
        [String(configuredChainId)]: cleanAddress,
      }));
      setGeneratedKey(null);
      setGeneratedAddress(null);
      void refreshAgentBalance();
      toast.success("Agent wallet created! Copy your private key now — it won't be shown again.");
    } catch (e: any) {
      setSaveError(`Network error: ${e.message || "check console"}`);
    } finally {
      setSavingWallet(false);
    }
  };

  const [resettingWallet, setResettingWallet] = useState(false);

  const handleResetCurrentWallet = async () => {
    if (!confirm(`Are you sure you want to remove the agent wallet for ${getChainLabel(configuredChainId)}? You can generate a new one right away.`)) {
      return;
    }
    setResettingWallet(true);
    try {
      const res = await apiFetch("/api/v1/agent/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoTopUp: permissions.autoTopUp,
          dispatch: permissions.dispatch,
          chainId: configuredChainId,
          resetCurrentWallet: true,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to reset agent wallet");
        return;
      }
      setAgentWallets((prev) => {
        const next = { ...prev };
        delete next[String(configuredChainId)];
        return next;
      });
      setAgentWalletAddress("");
      setGeneratedKey(null);
      setGeneratedAddress(null);
      setWalletBalance("0.00");
      setVaultBalance("0.00");
      setTotalBalance("0.00");
      setLastFundedSuccess(null);
      toast.success("Agent wallet reset. You can now generate a fresh wallet!");
    } catch (e: any) {
      toast.error(e?.message || "Failed to reset agent wallet");
    } finally {
      setResettingWallet(false);
    }
  };

  const handleResetAllWallets = async () => {
    if (!confirm("Are you sure you want to reset all agent wallets across all chains? This will clear all stored agent addresses.")) {
      return;
    }
    setResettingWallet(true);
    try {
      const res = await apiFetch("/api/v1/agent/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoTopUp: permissions.autoTopUp,
          dispatch: permissions.dispatch,
          chainId: configuredChainId,
          resetWallets: true,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to reset agent wallets");
        return;
      }
      setAgentWallets({});
      setAgentWalletAddress("");
      setGeneratedKey(null);
      setGeneratedAddress(null);
      setWalletBalance("0.00");
      setVaultBalance("0.00");
      setTotalBalance("0.00");
      setLastFundedSuccess(null);
      toast.success("All agent wallets reset! You can now generate a fresh wallet.");
    } catch (e: any) {
      toast.error(e?.message || "Failed to reset agent wallets");
    } finally {
      setResettingWallet(false);
    }
  };

  useEffect(() => {
    apiFetch("/api/v1/agent/permissions")
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

          // Resolve wallet address for the active chain
          let resolvedWallet = "";
          if (d.data.agentWallets && typeof d.data.agentWallets === "object") {
            const map: Record<string, string> = {};
            for (const [k, v] of Object.entries(d.data.agentWallets)) {
              let addrStr = "";
              if (typeof v === "string") {
                addrStr = v;
              } else if (v && typeof v === "object" && typeof (v as any).address === "string") {
                addrStr = (v as any).address;
              }
              if (addrStr) {
                map[k] =
                  isStellarChainId(Number(k)) || isSolanaChainId(Number(k))
                    ? addrStr
                    : (safeAddress(addrStr) ?? addrStr);
              }
            }
            setAgentWallets(map);
            resolvedWallet = map[String(configuredChainId)] || "";
          }

          if (!resolvedWallet && d.data.agentWalletAddress) {
            const rawAddr = d.data.agentWalletAddress;
            resolvedWallet = isNonEvm ? rawAddr : (safeAddress(rawAddr) ?? rawAddr);
          }

          if (resolvedWallet) {
            setAgentWalletAddress(resolvedWallet);
          }

          const loadedPreApprovals = Array.isArray(d.data.preApprovals) ? d.data.preApprovals : [];
          if (loadedPreApprovals.length > 0) {
            setPreApprovals(loadedPreApprovals);
          }

          // ✅ Fire balance refresh NOW with the correct wallet + preApprovals
          // (React state setters are async — if we relied on state here we'd get stale "")
          if (resolvedWallet || loadedPreApprovals.length > 0) {
            void refreshAgentBalance(resolvedWallet || undefined, loadedPreApprovals);
          }
        }
      })
      .catch(() => {
        toast.error("Failed to load agent settings");
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePermissions = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const res = await apiFetch("/api/v1/agent/permissions", {
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
      const res = await apiFetch("/api/v1/agent/dispatch/test", {
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
    <div className="space-y-6 max-w-3xl">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Agent Permissions & Treasury</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure your autonomous agent&apos;s on-chain keys, treasury balance, and dispatch automation rules.
        </p>
      </div>

      {/* ── Step 1: Agent Identity & Treasury ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-xs">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">Step 1: Agent Identity</h4>
                {agentWallet ? (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[11px] gap-1 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[11px] text-muted-foreground">
                    Action Required
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isStellar
                  ? "Dedicated Stellar keypair for signing x402 resource payments autonomously."
                  : "Dedicated on-chain signing key for autonomous x402 payment negotiation."}
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="text-xs font-mono shrink-0">
            {getChainLabel(configuredChainId)}
          </Badge>
        </div>

        {agentWallet ? (
          <div className="space-y-3 pt-1">
            {/* Active Wallet Display */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-border/80 bg-secondary/30">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Address</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(agentWallet);
                      toast.success("Agent address copied to clipboard");
                    }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy address"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={configuredChainId ? getExplorerTxUrl(configuredChainId, agentWallet).replace("/tx/", "/address/") : "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="View on Explorer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <code className="text-xs font-mono text-foreground font-medium block truncate mt-1">
                  {agentWallet}
                </code>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {Object.keys(agentWallets).length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowOtherWallets(!showOtherWallets)}
                    className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1"
                  >
                    <span>{Object.keys(agentWallets).length} Chains</span>
                    {showOtherWallets ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </Button>
                )}
                {confirmReset ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        void handleResetCurrentWallet();
                        setConfirmReset(false);
                      }}
                      disabled={resettingWallet}
                      className="h-8 text-xs"
                    >
                      {resettingWallet ? "Resetting…" : "Confirm Reset"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmReset(false)}
                      className="h-8 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmReset(true)}
                    className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    Reset Wallet
                  </Button>
                )}
              </div>
            </div>

            {/* Collapsible other chain addresses */}
            {showOtherWallets && Object.keys(agentWallets).length > 1 && (
              <div className="rounded-lg border border-border/60 bg-secondary/20 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between pb-1 border-b border-border/40">
                  <span className="font-medium text-muted-foreground uppercase text-[10px] tracking-wider">Multi-chain Addresses</span>
                  <button
                    onClick={handleResetAllWallets}
                    disabled={resettingWallet}
                    className="text-[11px] text-destructive hover:underline"
                  >
                    Reset All
                  </button>
                </div>
                {Object.entries(agentWallets).map(([cId, addr]) => (
                  <div key={cId} className="flex items-center justify-between gap-3 font-mono">
                    <span className="text-muted-foreground">{getChainLabel(Number(cId))}</span>
                    <span className="truncate">{addr}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Treasury Hero Card */}
            <div className="p-4 rounded-xl border border-border/80 bg-secondary/40 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Agent Available Balance
                  </p>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                      ${totalBalance ?? "0.00"}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">USDC</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshAgentBalance()}
                  disabled={refreshingBalance}
                  className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1.5"
                  title="Refresh on-chain balance"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", refreshingBalance && "animate-spin")} />
                  <span>{refreshingBalance ? "Updating…" : "Refresh"}</span>
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-3 rounded-lg border border-border/60 bg-background/60 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Direct Wallet</span>
                    <p className="text-sm font-semibold text-foreground mt-0.5">
                      ${walletBalance ?? "0.00"} <span className="text-xs font-normal text-muted-foreground">USDC</span>
                    </p>
                    <span className="text-[10px] text-muted-foreground">Instant payment execution</span>
                  </div>
                  <Wallet className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                </div>

                <div className="p-3 rounded-lg border border-border/60 bg-background/60 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Session Vault (ZKVUB)</span>
                    <p className="text-sm font-semibold text-foreground mt-0.5">
                      ${vaultBalance ?? "0.00"} <span className="text-xs font-normal text-muted-foreground">USDC</span>
                    </p>
                    <span className="text-[10px] text-muted-foreground">Continuous billing escrow</span>
                  </div>
                  <Database className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                </div>
              </div>
            </div>
          </div>
        ) : generatedAddress ? (
          /* Save Key Pair Display */
          <div className="space-y-3 p-4 rounded-lg border border-amber-500/40 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-2.5">
                <p className="text-sm font-semibold text-foreground">Save your agent credentials — shown once only</p>
                <div className="space-y-2">
                  <div>
                    <span className="text-[11px] text-muted-foreground uppercase font-medium">Public Address</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="text-xs font-mono bg-background border border-border px-2.5 py-1.5 rounded-md text-foreground flex-1 truncate">{generatedAddress}</code>
                      <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => { navigator.clipboard.writeText(generatedAddress); toast.success("Address copied"); }}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground uppercase font-medium">Private Key</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="text-xs font-mono bg-background border border-border px-2.5 py-1.5 rounded-md text-foreground flex-1 truncate">{generatedKey}</code>
                      <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => { navigator.clipboard.writeText(generatedKey!); toast.success("Private key copied"); }}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" onClick={handleSaveWallet} disabled={savingWallet}>
                    {savingWallet ? "Activating…" : "Save & Activate Wallet"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setGeneratedKey(null); setGeneratedAddress(null); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="text-center py-8 border border-dashed border-border rounded-xl">
            <div className="w-10 h-10 rounded-full bg-secondary/80 flex items-center justify-center mx-auto mb-3">
              <Wallet className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No agent wallet configured</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 mb-4">
              Generate a dedicated keypair for your agent to sign payments and draw entitlements autonomously.
            </p>
            <Button onClick={handleGenerateWallet} className="gap-2">
              <Plus className="w-4 h-4" />
              <span>Generate Agent Wallet</span>
            </Button>
          </div>
        )}
      </div>

      {/* ── Step 2: Fund Agent (Only unlocked if wallet is active) ── */}
      {agentWallet && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-xs">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground">Step 2: Fund Agent</h4>
                  {((totalBalance && parseFloat(totalBalance) > 0) || preApprovals.length > 0) ? (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[11px] gap-1 py-0.5">
                      <CheckCircle2 className="w-3 h-3" />
                      Funded (${totalBalance || "0.00"} USDC)
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground">
                      Awaiting Deposit
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Deposit USDC to enable your agent to execute autonomous API and resource payments.
                </p>
              </div>
            </div>
          </div>

          {/* Network Mismatch Notice */}
          {chainMismatch && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <p className="font-semibold text-amber-700 dark:text-amber-400">Network Mismatch</p>
                <p className="text-muted-foreground">
                  Your wallet is connected to network {evmChainId}. Switch to {configuredChainId} ({getChainLabel(configuredChainId)}) to fund.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={isSwitchingNetwork || !configuredChainId}
                onClick={() => configuredChainId && void switchChainAsync({ chainId: configuredChainId })}
                className="shrink-0 gap-1.5 h-8 text-xs"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                {isSwitchingNetwork ? "Switching…" : "Switch"}
              </Button>
            </div>
          )}

          {/* Source Wallet Status Pill */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border border-border/70 bg-secondary/20 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-muted-foreground">Source:</span>
              <code className="font-mono text-foreground font-medium">
                {isStellar
                  ? (stellar.address ? `${stellar.address.slice(0, 6)}…${stellar.address.slice(-4)}` : "Not connected")
                  : isSolana
                    ? (solana.address ? `${solana.address.slice(0, 6)}…${solana.address.slice(-4)}` : "Not connected")
                    : (userWallet ? `${userWallet.slice(0, 6)}…${userWallet.slice(-4)}` : "Not connected")}
              </code>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Available to fund:</span>
              <span className="font-semibold text-foreground">${userWalletBalance ?? "0.00"} USDC</span>
            </div>
          </div>

          {/* Success Alert Banner */}
          {lastFundedSuccess && (
            <div className="p-3.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    Successfully Funded with ${lastFundedSuccess.amount} USDC
                  </p>
                  <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                    {lastFundedSuccess.mode === "transfer"
                      ? "Direct on-chain transfer complete. Your agent can now spend funds."
                      : "Session Vault deposit confirmed. Vault balance is ready for settlements."}
                  </p>
                  {lastFundedSuccess.txHash && (
                    <a
                      href={getExplorerTxUrl(evmChainId || configuredChainId, lastFundedSuccess.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-emerald-600 dark:text-emerald-400 underline hover:opacity-80 inline-flex items-center gap-1 mt-1 font-mono"
                    >
                      View transaction ({lastFundedSuccess.txHash.slice(0, 8)}…{lastFundedSuccess.txHash.slice(-4)}) ↗
                    </a>
                  )}
                </div>
              </div>
              <button
                onClick={() => setLastFundedSuccess(null)}
                className="text-emerald-600 hover:text-emerald-800 p-1 text-xs"
              >
                ✕
              </button>
            </div>
          )}

          {/* Mode Selector for EVM */}
          {!isNonEvm && (
            <div className="grid grid-cols-2 p-1 rounded-lg bg-secondary/50 border border-border/70 text-xs">
              <button
                type="button"
                onClick={() => setFundingMode("direct")}
                className={cn(
                  "py-2 px-3 rounded-md font-medium text-center transition-all flex items-center justify-center gap-2",
                  fundingMode === "direct"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>Direct Transfer</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">Fastest</Badge>
              </button>
              <button
                type="button"
                onClick={() => {
                  setFundingMode("vault");
                  void checkAllowance();
                }}
                className={cn(
                  "py-2 px-3 rounded-md font-medium text-center transition-all flex items-center justify-center gap-2",
                  fundingMode === "vault"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Session Vault</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">ZKVUB</Badge>
              </button>
            </div>
          )}

          {/* Mode Guidance Callout */}
          {!isNonEvm && (
            fundingMode === "direct" ? (
              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs flex items-start gap-2.5">
                <ArrowRightLeft className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold text-foreground">Direct Transfer (Recommended for Agent Payments & MCP)</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Sends USDC directly to your AI agent&apos;s wallet (<code className="font-mono text-foreground font-medium">{agentWallet ? `${agentWallet.slice(0, 6)}…${agentWallet.slice(-4)}` : "agent"}</code>). Your agent directly controls these funds to pay payment links, purchase datasets, and make autonomous transactions.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs flex items-start gap-2.5">
                <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold text-foreground">Session Vault (ZKVUB Micropayment Batching)</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Pre-funds an on-chain session for high-frequency x402 API calls. <span className="font-medium text-foreground">Note:</span> Deposits from your browser wallet register your connected address (<code className="font-mono text-foreground font-medium">{userWallet ? `${userWallet.slice(0, 6)}…${userWallet.slice(-4)}` : "wallet"}</code>) as the session owner on-chain. To have your agent own its own session, use Direct Transfer to fund the agent wallet first and call <code className="font-mono text-foreground">agent.fundSession()</code>.
                  </p>
                </div>
              </div>
            )
          )}

          {/* Amount Input and Presets */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground">Deposit Amount</Label>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground mr-1">Presets:</span>
                {["5", "10", "25"].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setApproveAmount(amt)}
                    className={cn(
                      "px-2.5 py-0.5 rounded text-[11px] font-medium border transition-colors",
                      approveAmount === amt
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground border-border/60"
                    )}
                  >
                    ${amt}
                  </button>
                ))}
                {userWalletBalance && parseFloat(userWalletBalance) > 0 && (
                  <button
                    type="button"
                    onClick={() => setApproveAmount(userWalletBalance)}
                    className={cn(
                      "px-2.5 py-0.5 rounded text-[11px] font-medium border transition-colors",
                      approveAmount === userWalletBalance
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary/60 hover:bg-secondary text-primary border-primary/30"
                    )}
                  >
                    Max
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">$</span>
              <Input
                type="number"
                step="1"
                min="1"
                value={approveAmount}
                onChange={(e) => setApproveAmount(e.target.value)}
                className="pl-7 pr-16 h-10 text-sm font-medium"
                placeholder="10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground bg-secondary/80 px-2 py-0.5 rounded">
                USDC
              </span>
            </div>
          </div>

          {/* Execution Actions */}
          <div className="pt-2">
            {isStellar ? (
              stellar.isConnected && stellar.address ? (
                <Button
                  onClick={handlePreApprove}
                  disabled={!approveAmount || approving || parseFloat(approveAmount || "0") <= 0}
                  className="w-full h-10 gap-2 font-medium"
                >
                  {approving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Signing transfer in Stellar wallet…</span>
                    </>
                  ) : (
                    <>
                      <ArrowRightLeft className="w-4 h-4" />
                      <span>Transfer ${approveAmount || "0"} USDC to Agent</span>
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={() => void stellar.connect()} className="w-full h-10 gap-2">
                  <Wallet className="w-4 h-4" />
                  <span>Connect Stellar Wallet</span>
                </Button>
              )
            ) : isSolana ? (
              solana.isConnected && solana.address ? (
                <Button
                  onClick={handlePreApprove}
                  disabled={!approveAmount || approving || parseFloat(approveAmount || "0") <= 0}
                  className="w-full h-10 gap-2 font-medium"
                >
                  {approving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Signing transfer in Solana wallet…</span>
                    </>
                  ) : (
                    <>
                      <ArrowRightLeft className="w-4 h-4" />
                      <span>Transfer ${approveAmount || "0"} USDC to Agent</span>
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={() => void solana.connect()} className="w-full h-10 gap-2">
                  <Wallet className="w-4 h-4" />
                  <span>Connect Solana Wallet</span>
                </Button>
              )
            ) : isConnected && userWallet ? (
              fundingMode === "direct" ? (
                <Button
                  onClick={handleDirectTransfer}
                  disabled={!approveAmount || approving || isWaitingDirect || parseFloat(approveAmount || "0") <= 0}
                  className="w-full h-10 gap-2 font-medium"
                >
                  {approving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Confirm in your wallet…</span>
                    </>
                  ) : isWaitingDirect ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Confirming on {getChainLabel(configuredChainId)}…</span>
                    </>
                  ) : (
                    <>
                      <ArrowRightLeft className="w-4 h-4" />
                      <span>Transfer ${approveAmount || "0"} USDC to Agent</span>
                    </>
                  )}
                </Button>
              ) : (
                /* Session Vault 2-Step Progress */
                (() => {
                  const amountAtomic = parseUnits(approveAmount || "0", 6);
                  const hasAllowance = vaultAllowance !== null && vaultAllowance >= amountAtomic;
                  const step1Done = hasAllowance || approveStep === "fund";
                  const step1Active = !step1Done && !isWaitingApprove && !approving;
                  const step1Waiting = (approving && approveStep === "approve") || isWaitingApprove;
                  const step2Active = step1Done && !isWaitingFund && !approving;
                  const step2Waiting = (approving && approveStep === "fund") || isWaitingFund;

                  return (
                    <div className="space-y-3">
                      {/* Stage 1 */}
                      <div className={cn(
                        "flex items-center justify-between p-3.5 rounded-lg border transition-all",
                        step1Done
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : step1Waiting
                          ? "border-amber-500/40 bg-amber-500/5"
                          : "border-border/70 bg-secondary/20"
                      )}>
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                            step1Done ? "bg-emerald-500 text-white" : step1Waiting ? "bg-amber-500 text-white" : "bg-secondary text-muted-foreground border border-border"
                          )}>
                            {step1Done ? <Check className="w-3.5 h-3.5" /> : step1Waiting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "1"}
                          </div>
                          <div>
                            <p className={cn("text-xs font-semibold", step1Done ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
                              {step1Done ? `USDC Approval Confirmed` : `Approve USDC for Vault`}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {step1Done
                                ? "Session Vault is authorized to transfer your deposit"
                                : step1Waiting
                                ? "Waiting for block confirmation on-chain…"
                                : `Authorize vault to spend $${approveAmount || "0"} USDC`}
                            </p>
                          </div>
                        </div>
                        {!step1Done && (
                          <Button
                            onClick={handleVaultApprove}
                            disabled={!approveAmount || !step1Active}
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                          >
                            {step1Waiting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
                            <span>{step1Waiting ? "Confirming…" : "Approve"}</span>
                          </Button>
                        )}
                      </div>

                      {/* Stage 2 */}
                      <div className={cn(
                        "flex items-center justify-between p-3.5 rounded-lg border transition-all",
                        !step1Done && "opacity-50 pointer-events-none",
                        step2Waiting
                          ? "border-blue-500/40 bg-blue-500/5"
                          : step1Done
                          ? "border-border/80 bg-secondary/30"
                          : "border-border/40 bg-secondary/10"
                      )}>
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                            step2Waiting ? "bg-blue-500 text-white" : step1Done ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground border border-border"
                          )}>
                            {step2Waiting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "2"}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-foreground">
                              Deposit into Session Vault
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {step2Waiting
                                ? "Confirming vault deposit on-chain…"
                                : step1Done
                                ? `Moves $${approveAmount || "0"} USDC into escrow for your agent`
                                : "Requires Step 1 authorization first"}
                            </p>
                          </div>
                        </div>
                        {step1Done && (
                          <Button
                            onClick={handleVaultDeposit}
                            disabled={!approveAmount || !step2Active}
                            size="sm"
                            className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                          >
                            {step2Waiting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                            <span>{step2Waiting ? "Depositing…" : "Deposit Funds"}</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })()
              )
            ) : (
              <div className="text-center py-3 text-xs text-muted-foreground bg-secondary/30 rounded-lg border border-border/60">
                Please connect your wallet in the top right to fund this agent.
              </div>
            )}
          </div>

          {/* Recent Funding History */}
          {(() => {
            const chainPreApprovals = preApprovals.filter(
              (entry) => !entry.chainId || entry.chainId === configuredChainId,
            );
            if (chainPreApprovals.length === 0) return null;
            return (
              <div className="pt-3 border-t border-border/60">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
                  Recent Funding Activity
                </span>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {[...chainPreApprovals].reverse().slice(0, 5).map((entry, i) => (
                    <div key={`${entry.txHash}-${i}`} className="flex items-center justify-between p-2 rounded-md bg-secondary/30 border border-border/40 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                          {entry.mode === "transfer" ? "Direct Transfer" : "Session Vault"}
                        </Badge>
                        <span className="font-semibold text-foreground">+${entry.amount} USDC</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                        {entry.txHash && (
                          <a
                            href={getExplorerTxUrl(entry.chainId || configuredChainId, entry.txHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground inline-flex items-center"
                            title="View on Explorer"
                          >
                            <ArrowUpRight className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Automation & Dispatch Policies (Only when wallet exists) ── */}
      {agentWallet && (
        <>
          {/* Auto-Topup */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Auto-Topup Policies</h4>
                <p className="text-xs text-muted-foreground mt-0.5">Automatically replenish your agent&apos;s session balance when it drops below threshold.</p>
              </div>
              <select
                value={permissions.autoTopUp.mode}
                onChange={(e) => setPermissions({ ...permissions, autoTopUp: { ...permissions.autoTopUp, mode: e.target.value as "auto" | "dispatch" | "off" } })}
                className="text-xs bg-secondary/50 border border-border rounded-md px-3 py-1.5 text-foreground font-medium focus:outline-hidden"
              >
                <option value="off">Disabled</option>
                <option value="auto">Automatic Refill</option>
                <option value="dispatch">Dispatch (Approval via Chat)</option>
              </select>
            </div>

            {permissions.autoTopUp.mode !== "off" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Daily Spending Limit</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={permissions.autoTopUp.dailyLimit}
                      onChange={(e) => setPermissions({ ...permissions, autoTopUp: { ...permissions.autoTopUp, dailyLimit: e.target.value } })}
                      className="pl-6 h-9 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Per-Txn Limit</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={permissions.autoTopUp.perTxnLimit}
                      onChange={(e) => setPermissions({ ...permissions, autoTopUp: { ...permissions.autoTopUp, perTxnLimit: e.target.value } })}
                      className="pl-6 h-9 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Trigger Threshold</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={permissions.autoTopUp.threshold}
                      onChange={(e) => setPermissions({ ...permissions, autoTopUp: { ...permissions.autoTopUp, threshold: e.target.value } })}
                      className="pl-6 h-9 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dispatch Providers */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Dispatch Notification Channels</h4>
                <p className="text-xs text-muted-foreground mt-0.5">Receive and approve payment top-up requests directly through messaging apps.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowAddProvider(true)} className="gap-1.5 h-8 text-xs">
                <Plus className="w-3.5 h-3.5" />
                Add Channel
              </Button>
            </div>

            {permissions.dispatch.providers.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-border rounded-lg">
                <p className="text-xs text-muted-foreground">No dispatch channels connected yet.</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">Supports Telegram, Discord, Slack, and Email webhooks.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {permissions.dispatch.providers.map((p, i) => {
                  const detail =
                    p.type === "telegram" ? `Bot: ${(p.botToken || "").slice(0, 10)}… | Chat: ${p.chatId}` :
                    p.type === "discord" || p.type === "slack" ? (p.webhookUrl || "").slice(0, 36) + "…" :
                    p.email || "";
                  return (
                    <div key={i} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-secondary/20">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center text-xs font-bold text-foreground uppercase shrink-0 border border-border/50">
                          {p.type.slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{p.label || p.type}</p>
                          <p className="text-[11px] text-muted-foreground font-mono truncate">{detail}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => testDispatchProvider(i)}
                          disabled={testingIdx === i}
                          className="h-7 px-2 text-xs"
                        >
                          {testingIdx === i ? "Testing…" : "Test"}
                        </Button>
                        <button onClick={() => removeProvider(i)} className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {testResult && (
                  <div className={cn(
                    "text-xs px-3 py-2 rounded-md border",
                    testResult.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" : "bg-destructive/10 text-destructive border-destructive/30"
                  )}>
                    {testResult.message}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Save Permissions Action Bar */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card shadow-xs">
            <div>
              <p className="text-xs font-semibold text-foreground">Save Configuration</p>
              <p className="text-[11px] text-muted-foreground">Persist updated auto-topup thresholds and notification channels.</p>
            </div>
            <div className="flex items-center gap-3">
              {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ Saved successfully</span>}
              {saveError && <span className="text-xs text-destructive">{saveError}</span>}
              <Button onClick={savePermissions} disabled={saving || loading} className="h-9 px-4 text-xs font-medium">
                {loading ? "Loading…" : saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>
        </>
      )}

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
    apiFetch("/api/v1/agent/dispatch")
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
  const isStellar = Boolean(agentSectionChainId && isStellarChainId(agentSectionChainId));
  const isSolana = Boolean(agentSectionChainId && isSolanaChainId(agentSectionChainId));
  const stellar = useStellarWallet(agentSectionChainId ?? undefined);
  const solana = useSolanaWallet(agentSectionChainId ?? undefined);
  // Family-aware connection for the header badge: wagmi's isConnected is
  // meaningless on a Stellar/Solana environment.
  const walletConnected = isStellar
    ? stellar.isConnected
    : isSolana
      ? solana.isConnected
      : isConnected;

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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-sky-500/20 border border-border flex items-center justify-center">
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
