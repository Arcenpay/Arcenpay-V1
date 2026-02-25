'use client';

import React, { useEffect, useState } from 'react';

// ============================================================
//  BillingHistory — On-Chain Billing Events Display
//  PRD Section 5.1.3: Fetches and displays on-chain billing
//  events from SubscriptionRegistry (BillingSuccess, Renewed,
//  Cancelled events).
// ============================================================

export interface BillingEvent {
  type: 'payment' | 'renewal' | 'cancellation' | 'minted';
  tokenId: string;
  planId: string;
  amount: string;
  timestamp: number;
  transactionHash: string;
  blockNumber: number;
}

export interface BillingHistoryProps {
  /** Wallet address to query billing history for */
  walletAddress: string;
  /** SubscriptionRegistry contract address */
  registryAddress?: string;
  /** RPC URL for querying events */
  rpcUrl?: string;
  /** Maximum number of events to show */
  maxEvents?: number;
  /** Custom CSS class */
  className?: string;
}

export function BillingHistory({
  walletAddress,
  registryAddress,
  rpcUrl,
  maxEvents = 20,
  className = '',
}: BillingHistoryProps) {
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBillingEvents() {
      try {
        setLoading(true);

        // TODO: Use viem to query contract events from SubscriptionRegistry
        // For now, this is a structured placeholder that will be wired up
        // when the full SDK integration is complete.
        //
        // In production, this will:
        // 1. Create a viem public client with the provided RPC URL
        // 2. Query SubscriptionMinted, SubscriptionRenewed, SubscriptionCancelled,
        //    and BillingSuccess events filtered by wallet address
        // 3. Parse and sort events by timestamp

        const mockEvents: BillingEvent[] = [];
        setEvents(mockEvents);
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch billing history');
      } finally {
        setLoading(false);
      }
    }

    if (walletAddress) {
      fetchBillingEvents();
    }
  }, [walletAddress, registryAddress, rpcUrl, maxEvents]);

  const eventIcons: Record<string, string> = {
    payment: '💳',
    renewal: '🔄',
    cancellation: '❌',
    minted: '🎫',
  };

  const eventColors: Record<string, string> = {
    payment: '#22c55e',
    renewal: '#3b82f6',
    cancellation: '#ef4444',
    minted: '#a855f7',
  };

  if (loading) {
    return (
      <div className={`meap-billing-history meap-loading ${className}`}>
        <div className="meap-spinner" />
        <p>Loading billing history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`meap-billing-history meap-error ${className}`}>
        <p>⚠️ Error: {error}</p>
      </div>
    );
  }

  return (
    <div className={`meap-billing-history ${className}`}>
      <div className="meap-billing-header">
        <h3>Billing History</h3>
        <span className="meap-event-count">{events.length} events</span>
      </div>

      {events.length === 0 ? (
        <div className="meap-billing-empty">
          <p>No billing events found for this wallet.</p>
        </div>
      ) : (
        <div className="meap-billing-list">
          {events.slice(0, maxEvents).map((event, index) => (
            <div key={`${event.transactionHash}-${index}`} className="meap-billing-item">
              <div className="meap-billing-icon">
                <span>{eventIcons[event.type] || '📋'}</span>
              </div>
              <div className="meap-billing-details">
                <div className="meap-billing-type">
                  <span
                    className="meap-event-badge"
                    style={{ color: eventColors[event.type] || '#6b7280' }}
                  >
                    {event.type.charAt(0).toUpperCase() + event.type.slice(1)}
                  </span>
                  {event.amount && event.amount !== '0' && (
                    <span className="meap-billing-amount">{event.amount} USDC</span>
                  )}
                </div>
                <div className="meap-billing-meta">
                  <span className="meap-billing-date">
                    {new Date(event.timestamp * 1000).toLocaleDateString()}
                  </span>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${event.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="meap-tx-link"
                  >
                    {event.transactionHash.slice(0, 10)}...
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
