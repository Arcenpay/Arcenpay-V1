"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  Send,
  Download,
  ChevronDown,
  AlertTriangle,
  Link2,
  Repeat,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useEnvironment } from "@/contexts/environment-context";

type InvoiceStatus = "DRAFT" | "ISSUED" | "PAID" | "VOID" | "OVERDUE";
type DeliveryStatus = "PENDING" | "SENT" | "FAILED";
type InvoiceSource = "PAYMENT_LINK" | "SUBSCRIPTION" | "OTHER";
type InvoiceSourceFilter = "ALL" | InvoiceSource;

type InvoiceItem = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  currency: string;
  total: string;
  metadata?: {
    customerName?: string | null;
    [key: string]: unknown;
  } | null;
  customerEmail: string | null;
  customerWallet: string | null;
  issuedAt: string | null;
  createdAt: string;
  planId: string | null;
  deliveries: Array<{
    id: string;
    status: DeliveryStatus;
    createdAt: string;
  }>;
  paymentLinks: Array<{
    id: string;
    kind: string;
    name: string;
    slug: string;
  }>;
};

const STATUS_TRANSITIONS: Partial<Record<InvoiceStatus, InvoiceStatus[]>> = {
  DRAFT: ["ISSUED"],
  ISSUED: ["PAID", "VOID", "OVERDUE"],
  OVERDUE: ["PAID", "VOID"],
};

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issue",
  PAID: "Mark as Paid",
  VOID: "Void Invoice",
  OVERDUE: "Mark Overdue",
};

const SOURCE_COPY: Record<
  InvoiceSource,
  {
    label: string;
    description: string;
    empty: string;
  }
> = {
  PAYMENT_LINK: {
    label: "Payment Links",
    description: "One-time hosted checkout invoices created from shareable links.",
    empty: "No payment-link invoices found.",
  },
  SUBSCRIPTION: {
    label: "Subscriptions",
    description: "Recurring billing invoices tied to a catalog plan.",
    empty: "No subscription invoices found.",
  },
  OTHER: {
    label: "Other",
    description: "Manual or uncategorized invoices not tied to a link or subscription.",
    empty: "No other invoices found.",
  },
};

function classifyInvoice(invoice: InvoiceItem): InvoiceSource {
  if (invoice.paymentLinks.length > 0) return "PAYMENT_LINK";
  if (invoice.planId) return "SUBSCRIPTION";
  return "OTHER";
}

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  if (status === "PAID") {
    return (
      <Badge className="border-success/20 bg-success/10 text-success">
        PAID
      </Badge>
    );
  }
  if (status === "OVERDUE") {
    return <Badge variant="destructive">OVERDUE</Badge>;
  }
  if (status === "VOID") {
    return <Badge variant="secondary">VOID</Badge>;
  }
  if (status === "ISSUED") {
    return (
      <Badge className="border-accent/20 bg-accent/10 text-accent">
        ISSUED
      </Badge>
    );
  }
  return <Badge variant="secondary">DRAFT</Badge>;
}

function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  if (status === "SENT") {
    return (
      <Badge className="border-success/20 bg-success/10 text-xs text-success">
        Sent
      </Badge>
    );
  }
  if (status === "FAILED") {
    return (
      <Badge variant="destructive" className="gap-1 text-xs">
        <AlertTriangle className="h-3 w-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs">
      Pending
    </Badge>
  );
}

function InvoiceSourceBadge({
  invoice,
  source,
}: {
  invoice: InvoiceItem;
  source: InvoiceSource;
}) {
  if (source === "PAYMENT_LINK") {
    return (
      <Badge className="gap-1 border-sky-500/20 bg-sky-500/10 text-sky-200">
        <Link2 className="h-3 w-3" />
        {invoice.paymentLinks[0]?.name || "Payment Link"}
      </Badge>
    );
  }

  if (source === "SUBSCRIPTION") {
    return (
      <Badge className="gap-1 border-amber-500/20 bg-amber-500/10 text-amber-200">
        <Repeat className="h-3 w-3" />
        Subscription
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1">
      <FileText className="h-3 w-3" />
      Other
    </Badge>
  );
}

function InvoiceTable({
  rows,
  loading,
  busyId,
  emptyMessage,
  onMarkStatus,
  onDownload,
  onResend,
}: {
  rows: InvoiceItem[];
  loading: boolean;
  busyId: string | null;
  emptyMessage: string;
  onMarkStatus: (invoiceId: string, newStatus: InvoiceStatus) => Promise<void>;
  onDownload: (invoiceId: string) => Promise<void>;
  onResend: (invoiceId: string) => Promise<void>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Total</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Issued</TableHead>
          <TableHead>Delivery</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && (
          <TableRow>
            <TableCell
              colSpan={8}
              className="py-8 text-center text-muted-foreground"
            >
              Loading invoices...
            </TableCell>
          </TableRow>
        )}
        {!loading && rows.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={8}
              className="py-8 text-center text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        )}
        {!loading &&
          rows.map((invoice) => {
            const latestDelivery = invoice.deliveries[0];
            const transitions = STATUS_TRANSITIONS[invoice.status] ?? [];
            const isBusy = busyId === invoice.id;
            const source = classifyInvoice(invoice);

            return (
              <TableRow key={invoice.id}>
                <TableCell className="font-medium">
                  <div className="space-y-1">
                    <p>{invoice.number || invoice.id.slice(0, 10)}</p>
                    {source === "PAYMENT_LINK" && invoice.paymentLinks[0] ? (
                      <p className="text-xs text-muted-foreground">
                        /pay/{invoice.paymentLinks[0].slug}
                      </p>
                    ) : source === "SUBSCRIPTION" && invoice.planId ? (
                      <p className="text-xs text-muted-foreground">
                        Plan {invoice.planId.slice(0, 8)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(invoice.createdAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <InvoiceSourceBadge invoice={invoice} source={source} />
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <div className="space-y-1">
                    <p className="truncate font-medium text-foreground">
                      {invoice.metadata?.customerName || "Unknown customer"}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {invoice.customerEmail || invoice.customerWallet || "N/A"}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  {Number(invoice.total).toFixed(2)} {invoice.currency}
                </TableCell>
                <TableCell>
                  <InvoiceStatusBadge status={invoice.status} />
                </TableCell>
                <TableCell>
                  {invoice.issuedAt
                    ? new Date(invoice.issuedAt).toLocaleDateString()
                    : "N/A"}
                </TableCell>
                <TableCell>
                  {latestDelivery ? (
                    <DeliveryBadge status={latestDelivery.status} />
                  ) : (
                    <span className="text-xs text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    {transitions.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" disabled={isBusy}>
                            Mark
                            <ChevronDown className="ml-1 h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {transitions.map((target) => (
                            <DropdownMenuItem
                              key={target}
                              onClick={() => onMarkStatus(invoice.id, target)}
                            >
                              {STATUS_LABELS[target]}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => onDownload(invoice.id)}
                    >
                      <Download className="mr-1 h-4 w-4" />
                      PDF
                    </Button>
                    <Button
                      variant={
                        latestDelivery?.status === "FAILED"
                          ? "destructive"
                          : "outline"
                      }
                      size="sm"
                      disabled={isBusy || !invoice.customerEmail}
                      onClick={() => onResend(invoice.id)}
                    >
                      <Send className="mr-1 h-4 w-4" />
                      {latestDelivery?.status === "FAILED" ? "Retry" : "Resend"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
      </TableBody>
    </Table>
  );
}

export function InvoicesSection() {
  const { envMode, activeEnvironment } = useEnvironment();
  const environmentKey = activeEnvironment?.id ?? envMode;
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | InvoiceStatus>("ALL");
  const [sourceFilter, setSourceFilter] =
    useState<InvoiceSourceFilter>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status !== "ALL") params.set("status", status);
      const res = await fetch(`/api/invoices?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load invoices");
      setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load invoices",
      );
    } finally {
      setLoading(false);
    }
  }, [environmentKey, query, status]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const sourceCounts = useMemo(() => {
    const counts: Record<InvoiceSource, number> = {
      PAYMENT_LINK: 0,
      SUBSCRIPTION: 0,
      OTHER: 0,
    };

    for (const invoice of invoices) {
      counts[classifyInvoice(invoice)] += 1;
    }

    return counts;
  }, [invoices]);

  const filteredRows = useMemo(() => {
    if (sourceFilter === "ALL") return invoices;
    return invoices.filter((invoice) => classifyInvoice(invoice) === sourceFilter);
  }, [invoices, sourceFilter]);

  const handleResend = async (invoiceId: string) => {
    setBusyId(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/resend`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Resend failed");
      toast.success("Invoice sent");
      await fetchInvoices();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resend failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (invoiceId: string) => {
    setBusyId(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/download`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Download unavailable");
      const url = data.downloadUrl as string | undefined;
      if (!url) throw new Error("Download URL unavailable");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkStatus = async (
    invoiceId: string,
    newStatus: InvoiceStatus,
  ) => {
    setBusyId(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status update failed");
      toast.success(`Invoice marked as ${newStatus.toLowerCase()}`);
      await fetchInvoices();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status update failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base font-medium">
              Invoice Center
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep one-time payment-link invoices separate from recurring subscription billing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchInvoices}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 md:grid-cols-3">
            {(["PAYMENT_LINK", "SUBSCRIPTION", "OTHER"] as InvoiceSource[]).map(
              (source) => (
                <div
                  key={source}
                  className="rounded-xl border border-border bg-secondary/35 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {SOURCE_COPY[source].label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {sourceCounts[source]}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {SOURCE_COPY[source].description}
                  </p>
                </div>
              ),
            )}
          </div>

          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search invoice number, email, wallet"
                className="pl-9"
              />
            </div>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "ALL" | InvoiceStatus)
              }
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="ALL">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="ISSUED">Issued</option>
              <option value="PAID">Paid</option>
              <option value="VOID">Void</option>
              <option value="OVERDUE">Overdue</option>
            </select>
          </div>

          <Tabs
            value={sourceFilter}
            onValueChange={(value) =>
              setSourceFilter(value as InvoiceSourceFilter)
            }
            className="space-y-4"
          >
            <TabsList className="h-auto flex-wrap gap-1 border border-border bg-secondary p-1">
              <TabsTrigger
                value="ALL"
                className="data-[state=active]:bg-card data-[state=active]:text-foreground"
              >
                All
                <span className="ml-2 text-xs text-muted-foreground">
                  {invoices.length}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="PAYMENT_LINK"
                className="data-[state=active]:bg-card data-[state=active]:text-foreground"
              >
                Payment Links
                <span className="ml-2 text-xs text-muted-foreground">
                  {sourceCounts.PAYMENT_LINK}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="SUBSCRIPTION"
                className="data-[state=active]:bg-card data-[state=active]:text-foreground"
              >
                Subscriptions
                <span className="ml-2 text-xs text-muted-foreground">
                  {sourceCounts.SUBSCRIPTION}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="OTHER"
                className="data-[state=active]:bg-card data-[state=active]:text-foreground"
              >
                Other
                <span className="ml-2 text-xs text-muted-foreground">
                  {sourceCounts.OTHER}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ALL" className="space-y-3">
              <div className="rounded-xl border border-border/70 bg-background/40 p-4">
                <p className="text-sm font-medium text-foreground">
                  All invoice activity
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review every invoice with its billing source labeled clearly.
                </p>
              </div>
              <InvoiceTable
                rows={filteredRows}
                loading={loading}
                busyId={busyId}
                emptyMessage="No invoices found."
                onMarkStatus={handleMarkStatus}
                onDownload={handleDownload}
                onResend={handleResend}
              />
            </TabsContent>

            {(["PAYMENT_LINK", "SUBSCRIPTION", "OTHER"] as InvoiceSource[]).map(
              (source) => (
                <TabsContent key={source} value={source} className="space-y-3">
                  <div className="rounded-xl border border-border/70 bg-background/40 p-4">
                    <p className="text-sm font-medium text-foreground">
                      {SOURCE_COPY[source].label}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {SOURCE_COPY[source].description}
                    </p>
                  </div>
                  <InvoiceTable
                    rows={filteredRows}
                    loading={loading}
                    busyId={busyId}
                    emptyMessage={SOURCE_COPY[source].empty}
                    onMarkStatus={handleMarkStatus}
                    onDownload={handleDownload}
                    onResend={handleResend}
                  />
                </TabsContent>
              ),
            )}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
