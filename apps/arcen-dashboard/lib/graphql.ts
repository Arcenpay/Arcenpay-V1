// ============================================================
//  Dashboard — Apollo Client + Subgraph Queries
//
//  Read-path policy:
//    USE SUBGRAPH for: analytics, aggregates, paginated history,
//      billing events, plan/subscriber lists.  Eventual consistency
//      (1-2 block lag) is acceptable for these.
//    USE chain-reader.ts for: live subscription status, session
//      balances, cross-chain entitlement — anywhere correctness
//      matters more than speed.
// ============================================================

import { ApolloClient, InMemoryCache, HttpLink, gql } from "@apollo/client";
import { GRAPH_URL } from "@/lib/config";

export const apolloClient = new ApolloClient({
  link: new HttpLink({ uri: GRAPH_URL || undefined }),
  cache: new InMemoryCache(),
});

// ── Queries ──────────────────────────────────────────────────

export const GET_PROVIDER_PLANS = gql`
  query GetProviderPlans($provider: Bytes!) {
    plans(where: { provider: $provider }, orderBy: createdAt, orderDirection: desc) {
      id
      name
      tier
      price
      billingInterval
      acceptedToken
      active
      createdAt
      subscriberCount
    }
  }
`;

export const GET_SUBSCRIBERS = gql`
  query GetSubscribers($provider: Bytes!, $planIds: [String!]) {
    subscriptions: subscriptionRecords(
      where: { plan_in: $planIds }
      orderBy: mintedAt
      orderDirection: desc
      first: 500
    ) {
      id
      subscriber
      plan {
        id
        name
        tier
        price
      }
      expiration
      isActive
      mintedAt
      amountPaid
      txHash
    }
  }
`;

export const GET_BILLING_EVENTS = gql`
  query GetBillingEvents($first: Int!, $skip: Int!) {
    billingEvents(
      orderBy: timestamp
      orderDirection: desc
      first: $first
      skip: $skip
    ) {
      id
      eventType
      tokenId
      planId
      sessionId
      amount
      actor
      txHash
      blockNumber
      timestamp
    }
  }
`;

export const GET_SESSIONS = gql`
  query GetSessions($first: Int!) {
    sessions(orderBy: totalFunded, orderDirection: desc, first: $first) {
      id
      agent
      totalFunded
      totalWithdrawn
      totalSettled
      currentBalance
      settlements(orderBy: timestamp, orderDirection: desc, first: 5) {
        id
        callCount
        settlementAmount
        timestamp
        txHash
      }
    }
  }
`;

export const GET_PROOF_SUBMISSIONS = gql`
  query GetProofSubmissions($first: Int!) {
    proofSubmissions(orderBy: timestamp, orderDirection: desc, first: $first) {
      id
      sessionId
      agentAddress
      callCount
      settlementAmount
      windowStart
      windowEnd
      txHash
      timestamp
    }
  }
`;

export const GET_PROTOCOL_STATS = gql`
  query GetProtocolStats {
    protocolStats(id: "global") {
      id
      totalSubscriptions
      activeSubscriptions
      totalPlans
      totalRevenue
      totalSettlements
      totalSettlementVolume
      totalSessionsFunded
    }
  }
`;

// ── Subscription history (analytics only — use chain-reader for live status) ──

/**
 * Returns on-chain subscription history for a token ID from the subgraph.
 * NOTE: This may lag 1-2 blocks behind chain tip.
 * For gate-keeping and live entitlement checks use getSubscriptionStatus()
 * from lib/chain-reader.ts which reads directly from the contract.
 */
export const GET_SUBSCRIPTION_HISTORY = gql`
  query GetSubscriptionHistory($tokenId: String!) {
    subscription: subscriptionRecord(id: $tokenId) {
      id
      subscriber
      plan {
        id
        name
        tier
        price
        billingInterval
      }
      expiration
      isActive
      mintedAt
      amountPaid
      txHash
    }
  }
`;

// ── Subgraph health check ──────────────────────────────────────────────────────

export interface SubgraphHealth {
  healthy: boolean;
  /** Seconds the subgraph is behind chain tip; null if unavailable */
  lagSeconds: number | null;
  /** Latest indexed block number; null if unavailable */
  latestBlock: number | null;
  error?: string;
}

/**
 * Checks The Graph indexing health for the MEAP subgraph.
 * Uses the Graph Node status API (`_meta` field).
 *
 * A lag > 60s is considered degraded; > 300s is considered unhealthy.
 * Returns healthy=true even with moderate lag so callers can decide their own threshold.
 */
export async function checkSubgraphHealth(): Promise<SubgraphHealth> {
  if (!GRAPH_URL) {
    return { healthy: false, lagSeconds: null, latestBlock: null, error: "GRAPH_URL not configured" };
  }

  try {
    const result = await apolloClient.query<{
      _meta: {
        block: { number: number; timestamp: number | null };
        hasIndexingErrors: boolean;
      };
    }>({
      query: gql`
        query SubgraphMeta {
          _meta {
            block {
              number
              timestamp
            }
            hasIndexingErrors
          }
        }
      `,
      fetchPolicy: "no-cache",
    });

    const meta = result.data._meta;
    const latestBlock = meta.block.number;
    const blockTimestamp = meta.block.timestamp;

    const lagSeconds =
      blockTimestamp != null
        ? Math.max(0, Math.floor(Date.now() / 1000) - blockTimestamp)
        : null;

    return {
      healthy: !meta.hasIndexingErrors,
      lagSeconds,
      latestBlock,
    };
  } catch (err) {
    return {
      healthy: false,
      lagSeconds: null,
      latestBlock: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
