// ============================================================
//  Facilitator — Agent Balance Monitor
//  Polls agent balances and triggers dispatch notifications
//  when balance drops below the configured threshold.
// ============================================================

import { randomUUID } from "node:crypto";
import type { PublicClient } from "viem";
import { formatUnits } from "viem";
import { SessionVaultABI } from "@arcenpay/internal-core";

interface AgentConfig {
  teamId: string;
  autoTopUp: {
    mode: "off" | "auto" | "dispatch";
    dailyLimit: string;
    perTxnLimit: string;
    threshold: string;
  };
  dispatch: {
    enabled: boolean;
    providers: Array<{
      type: string;
      label?: string;
      enabled: boolean;
      botToken?: string;
      chatId?: string;
      webhookUrl?: string;
      email?: string;
    }>;
    cooldownSeconds: number;
    maxRetries: number;
  };
}

interface DispatchRecord {
  requestId: string;
  teamId: string;
  agentAddress: string;
  amount: string;
  sentAt: number;
}

interface BalanceMonitorOptions {
  apiBaseUrl: string;
  facilitatorSecret?: string;
  publicClient: PublicClient;
  sessionVaultAddress: string;
  pollIntervalMs?: number;
  onDispatch: (record: DispatchRecord, provider: AgentConfig["dispatch"]["providers"][0]) => Promise<void>;
}

export class BalanceMonitor {
  private opts: BalanceMonitorOptions;
  private interval: ReturnType<typeof setInterval> | null = null;
  private dispatchRecords: Map<string, DispatchRecord> = new Map();
  private cooldowns: Map<string, number> = new Map();

  constructor(opts: BalanceMonitorOptions) {
    this.opts = { pollIntervalMs: 30000, ...opts };
  }

  start(): void {
    if (this.interval) return;
    console.log(
      `[BalanceMonitor] Starting (poll every ${this.opts.pollIntervalMs! / 1000}s)`,
    );
    // Give the local backend 5s to finish route registration on cold start
    setTimeout(() => {
      this.tick().catch(() => {});
    }, 5000);
    this.interval = setInterval(() => this.tick(), this.opts.pollIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log("[BalanceMonitor] Stopped");
    }
  }

  private async tick(): Promise<void> {
    try {
      const configs = await this.fetchAgentConfigs();
      if (configs.length === 0) return;

      for (const config of configs) {
        await this.checkAgent(config);
      }
    } catch (err) {
      console.error("[BalanceMonitor] Tick error:", err);
    }
  }

  private async fetchAgentConfigs(): Promise<AgentConfig[]> {
    try {
      const headers: Record<string, string> = {};
      if (this.opts.facilitatorSecret) {
        headers.Authorization = `Bearer ${this.opts.facilitatorSecret}`;
      }
      const raw = (this.opts.apiBaseUrl || "http://127.0.0.1:3300").trim().replace(/\/+$/, "");
      const cleanBase = raw.endsWith("/api/v1")
        ? raw.slice(0, -"/api/v1".length).replace(/\/$/, "")
        : raw.endsWith("/api")
        ? raw.slice(0, -"/api".length).replace(/\/$/, "")
        : raw;
      const url = `${cleanBase}/api/v1/internal/agent/configs`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status !== 404) {
          console.warn(`[BalanceMonitor] Failed to fetch configs from ${url}: ${res.status}`);
        }
        return [];
      }
      const data = await res.json();
      return Array.isArray(data.configs) ? data.configs : [];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
        console.warn(`[BalanceMonitor] Backend API offline at ${this.opts.apiBaseUrl}. Retrying next tick.`);
      } else {
        console.warn("[BalanceMonitor] Error fetching configs:", msg);
      }
      return [];
    }
  }

  private async checkAgent(config: AgentConfig): Promise<void> {
    const { teamId, autoTopUp, dispatch: dispatchCfg } = config;

    if (!autoTopUp || autoTopUp.mode !== "dispatch") return;
    if (!dispatchCfg?.providers?.length) return;

    const enabledProviders = dispatchCfg.providers.filter(
      (p) => p.enabled && (p.type === "telegram" ? p.botToken && p.chatId : true),
    );
    if (enabledProviders.length === 0) return;

    const rawThreshold = parseFloat(autoTopUp.threshold || "0.50");
    const rawPerTxn = parseFloat(autoTopUp.perTxnLimit || "1.00");
    const rawDaily = parseFloat(autoTopUp.dailyLimit || "5.00");
    const thresholdAtomic = (Number.isFinite(rawThreshold) ? rawThreshold : 0.50) * 1_000_000;
    const perTxnAtomic = (Number.isFinite(rawPerTxn) ? rawPerTxn : 1.00) * 1_000_000;
    const dailyLimitAtomic = (Number.isFinite(rawDaily) ? rawDaily : 5.00) * 1_000_000;

    // Check cooldown
    const cooldownKey = `cooldown:${teamId}`;
    const lastDispatch = this.cooldowns.get(cooldownKey) ?? 0;
    const cooldownMs = (dispatchCfg.cooldownSeconds || 120) * 1000;
    if (Date.now() - lastDispatch < cooldownMs) return;

    try {
      // Read balance from on-chain
      // We need the agent address. For now, derive it from config.
      // The agent address is stored in the session data, not in the config.
      // We'll read sessions for this team from the subgraph.
      const sessions = await this.fetchAgentSessions(teamId);
      if (sessions.length === 0) return;

      for (const session of sessions) {
        const balance = BigInt(session.currentBalance || "0");
        const threshold = BigInt(Math.floor(thresholdAtomic));

        if (balance >= threshold) continue;

        const deficit = threshold - balance;
        const topUpAmount = (deficit * 110n) / 100n; // 10% buffer
        const capped = topUpAmount > BigInt(Math.floor(perTxnAtomic))
          ? BigInt(Math.floor(perTxnAtomic))
          : topUpAmount;

        const amountUsdc = formatUnits(capped, 6);
        const agentAddress = session.agent;

        const record: DispatchRecord = {
          requestId: `dispatch_${Date.now()}_${randomUUID()}`,
          teamId,
          agentAddress,
          amount: capped.toString(),
          sentAt: Date.now(),
        };

        // Send to all enabled providers
        for (const provider of enabledProviders) {
          try {
            await this.opts.onDispatch(record, provider);
            console.log(
              `[BalanceMonitor] Dispatch sent: agent=${agentAddress.slice(0, 10)}… ` +
              `amount=$${amountUsdc} team=${teamId} provider=${provider.type}`,
            );
          } catch (err) {
            console.error(`[BalanceMonitor] Dispatch to ${provider.type} failed:`, err);
          }
        }

        this.dispatchRecords.set(record.requestId, record);
        this.cooldowns.set(cooldownKey, Date.now());
        break; // One dispatch per tick per team
      }
    } catch (err) {
      console.error(`[BalanceMonitor] Error checking agent ${teamId}:`, err);
    }
  }

  private async fetchAgentSessions(teamId: string): Promise<Array<{ agent: string; currentBalance: string }>> {
    // Fetch sessions for the specific team from the subgraph via dashboard API
    try {
      const headers: Record<string, string> = {};
      if (this.opts.facilitatorSecret) {
        headers.Authorization = `Bearer ${this.opts.facilitatorSecret}`;
      }
      const res = await fetch(
        `${this.opts.apiBaseUrl}/api/v1/platform/sessions?sessionLimit=10&teamId=${encodeURIComponent(teamId)}`,
        { headers },
      );
      if (!res.ok) return [];
      const data = await res.json();
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      return sessions.map((s: any) => ({
        agent: s.agent,
        currentBalance: s.currentBalance,
      }));
    } catch {
      return [];
    }
  }
}
