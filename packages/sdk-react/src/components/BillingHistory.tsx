'use client';

import React, { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { SubscriptionRegistryABI, getContractAddresses } from '@meap/core';
import { useMEAP } from '../providers/MEAPProvider';

// ============================================================
//  BillingHistory — On-Chain Billing Events Display
//  Queries real SubscriptionRegistry events via viem
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
  /** Maximum number of events to show */
  maxEvents?: number;
  /** Custom CSS class */
  className?: string;
}

export function BillingHistory({
  walletAddress,
  maxEvents = 20,
  className = '',
}: BillingHistoryProps) {
  const { network } = useMEAP();
  const contracts = getContractAddresses(network.chainId);
  const publicClient = usePublicClient({ chainId: network.chainId });

  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const registryAddress = contracts.subscriptionRegistry as `0x${string}`;

  // Explorer URL helper
  const getExplorerBase = () => {
    const explorers: Record<number, string> = {
      11155111: 'https://sepolia.etherscan.io',
      84532: 'https://sepolia.basescan.org',
      8453: 'https://basescan.org',
    };
    return explorers[network.chainId] || explorers[11155111];
  };

  useEffect(() => {
    async function fetchBillingEvents() {
      if (!publicClient || !walletAddress) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const allEvents: BillingEvent[] = [];

        // Query SubscriptionMinted events for this wallet
        const mintedLogs = await publicClient.getLogs({
          address: registryAddress,
          event: {
            type: 'event',
            name: 'SubscriptionMinted',
            inputs: [
              { name: 'subscriber', type: 'address', indexed: true },
              { name: 'tokenId', type: 'uint256', indexed: true },
              { name: 'planId', type: 'uint256', indexed: true },
              { name: 'expiration', type: 'uint64', indexed: false },
            ],
          },
          args: { subscriber: walletAddress as `0x${string}` },
          fromBlock: 0n,
          toBlock: 'latest',
        });

        for (const log of mintedLogs) {
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          allEvents.push({
            type: 'minted',
            tokenId: String(log.args.tokenId),
            planId: String(log.args.planId),
            amount: '0',
            timestamp: Number(block.timestamp),
            transactionHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }

        // Query SubscriptionRenewed events
        const renewedLogs = await publicClient.getLogs({
          address: registryAddress,
          event: {
            type: 'event',
            name: 'SubscriptionRenewed',
            inputs: [
              { name: 'tokenId', type: 'uint256', indexed: true },
              { name: 'newExpiration', type: 'uint64', indexed: false },
              { name: 'amountPaid', type: 'uint256', indexed: false },
            ],
          },
          fromBlock: 0n,
          toBlock: 'latest',
        });

        for (const log of renewedLogs) {
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          const amountPaid = log.args.amountPaid as bigint;
          allEvents.push({
            type: 'renewal',
            tokenId: String(log.args.tokenId),
            planId: '',
            amount: (Number(amountPaid) / 1e6).toFixed(2),
            timestamp: Number(block.timestamp),
            transactionHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }

        // Query SubscriptionCancelled events
        const cancelledLogs = await publicClient.getLogs({
          address: registryAddress,
          event: {
            type: 'event',
            name: 'SubscriptionCancelled',
            inputs: [
              { name: 'tokenId', type: 'uint256', indexed: true },
            ],
          },
          fromBlock: 0n,
          toBlock: 'latest',
        });

        for (const log of cancelledLogs) {
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          allEvents.push({
            type: 'cancellation',
            tokenId: String(log.args.tokenId),
            planId: '',
            amount: '0',
            timestamp: Number(block.timestamp),
            transactionHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          });
        }

        // Sort by timestamp descending (newest first)
        allEvents.sort((a, b) => b.timestamp - a.timestamp);
        setEvents(allEvents.slice(0, maxEvents));
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch billing history');
      } finally {
        setLoading(false);
      }
    }

    fetchBillingEvents();
  }, [walletAddress, publicClient, registryAddress, maxEvents]);

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

  const explorerBase = getExplorerBase();

  if (loading) {
    return (
      <div className={`meap-billing-history meap-loading ${className}`}>
        <div className="meap-spinner" />
        <p>Loading billing history from chain...</p>
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
          {events.map((event, index) => (
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
                    href={`${explorerBase}/tx/${event.transactionHash}`}
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
