import {
  shouldSponsorGas,
  evaluatePaymasterRequest,
  getDailyGasSpend,
  recordGasSpend,
  checkWalletAbuseLimit,
  isChainSponsorEligible,
  getGasSpendHistory,
  type SponsorDecision,
  type GasBudgetInfo,
  type SponsoredTxType,
  type PaymasterRequest,
  type PaymasterResponse,
} from '../lib/platform/gas-policy';
import {
  apolloClient,
  checkSubgraphHealth,
  type SubgraphHealth,
} from '../lib/platform/graphql';
import {
  aggregateUsage,
  invalidateUsageCache,
} from '../lib/platform/event-aggregator';

export class PlatformError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

export class PlatformService {
  // ── Gas Policy ─────────────────────────────────────────────────────────────

  async shouldSponsorGas(
    teamId: string,
    chainId: number,
    txType?: SponsoredTxType,
    walletAddress?: string,
  ): Promise<SponsorDecision> {
    return shouldSponsorGas(teamId, chainId, txType, walletAddress);
  }

  async evaluatePaymasterRequest(
    req: PaymasterRequest,
  ): Promise<PaymasterResponse> {
    try {
      return await evaluatePaymasterRequest(req);
    } catch (error) {
      throw new PlatformError(
        error instanceof Error ? error.message : "Paymaster evaluation failed",
        502,
        "PAYMASTER_EVALUATION_FAILED",
      );
    }
  }

  async getDailyGasSpend(teamId: string): Promise<GasBudgetInfo> {
    try {
      return await getDailyGasSpend(teamId);
    } catch (error) {
      throw new PlatformError(
        error instanceof Error ? error.message : "Failed to get daily gas spend",
        500,
        "GAS_SPEND_QUERY_FAILED",
      );
    }
  }

  async recordGasSpend(params: {
    teamId: string;
    chainId: number;
    txHash: string;
    gasUsedWei: string;
    gasCostUsd: number;
    walletAddress?: string;
  }): Promise<void> {
    try {
      await recordGasSpend(params);
    } catch (error) {
      throw new PlatformError(
        error instanceof Error ? error.message : "Failed to record gas spend",
        500,
        "GAS_SPEND_RECORD_FAILED",
      );
    }
  }

  async checkWalletAbuseLimit(
    teamId: string,
    walletAddress: string,
  ): Promise<{ allowed: boolean; txCount: number; limit: number }> {
    return checkWalletAbuseLimit(teamId, walletAddress);
  }

  isChainSponsorEligible(chainId: number): boolean {
    return isChainSponsorEligible(chainId);
  }

  async getGasSpendHistory(
    teamId: string,
    days?: number,
  ): Promise<{ date: string; totalUsd: number; txCount: number }[]> {
    return getGasSpendHistory(teamId, days);
  }

  // ── GraphQL / Subgraph ─────────────────────────────────────────────────────

  async checkSubgraphHealth(): Promise<SubgraphHealth> {
    return checkSubgraphHealth();
  }

  getApolloClient() {
    return apolloClient;
  }

  // ── Event Aggregation ──────────────────────────────────────────────────────

  async aggregateUsage(
    teamId: string,
    companyId: string,
    metricKey: string,
    period?: string,
  ): Promise<number> {
    try {
      return await aggregateUsage(teamId, companyId, metricKey, period);
    } catch (error) {
      throw new PlatformError(
        error instanceof Error ? error.message : "Failed to aggregate usage",
        500,
        "USAGE_AGGREGATION_FAILED",
      );
    }
  }

  invalidateUsageCache(teamId: string, companyId: string, metricKey?: string) {
    invalidateUsageCache(teamId, companyId, metricKey);
  }
}

export const platformService = new PlatformService();
