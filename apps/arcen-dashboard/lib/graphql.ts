// ============================================================
//  Dashboard — Apollo Client + Subgraph Queries
// ============================================================

import { ApolloClient, InMemoryCache, HttpLink, gql } from "@apollo/client";

const GRAPH_URL =
  process.env.NEXT_PUBLIC_GRAPH_URL ||
  "https://api.studio.thegraph.com/query/placeholder/meap-sepolia/version/latest";

export const apolloClient = new ApolloClient({
  link: new HttpLink({ uri: GRAPH_URL }),
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
    subscriptions(
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
