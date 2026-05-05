'use client';

import React, { useEffect, useState } from 'react';
import type { InvoiceSummary } from '@arcenpay/sdk';
import { formatCurrency } from '@arcenpay/sdk';

export interface InvoiceListProps {
  endpoint?: string;
  className?: string;
  limit?: number;
}

/**
 * Lists invoice summaries from dashboard invoice API.
 */
export function InvoiceList({
  endpoint = '/api/invoices',
  className = '',
  limit = 20,
}: InvoiceListProps) {
  const [items, setItems] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${endpoint}?limit=${limit}`);
        if (!response.ok) {
          throw new Error(`Failed to load invoices (${response.status})`);
        }
        const payload = (await response.json()) as { invoices?: InvoiceSummary[] };
        if (!cancelled) {
          setItems(Array.isArray(payload.invoices) ? payload.invoices : []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load invoices');
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [endpoint, limit]);

  if (loading) {
    return (
      <div className={`arcenpay-invoice-list arcenpay-loading ${className}`}>
        <p>Loading invoices...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`arcenpay-invoice-list arcenpay-error ${className}`}>
        <p>{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={`arcenpay-invoice-list ${className}`}>
        <p>No invoices found.</p>
      </div>
    );
  }

  return (
    <div className={`arcenpay-invoice-list ${className}`}>
      {items.map((invoice) => (
        <div key={invoice.id} className="arcenpay-invoice-row">
          <div>
            <strong>{invoice.number || invoice.id}</strong>
            <p>{invoice.customerEmail || invoice.customerWallet || 'Unknown customer'}</p>
          </div>
          <div>
            <p>{formatCurrency(invoice.total, invoice.currency)}</p>
            <p>{invoice.status}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
