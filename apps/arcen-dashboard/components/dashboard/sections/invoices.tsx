"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  Send,
  Download,
  ChevronDown,
  AlertTriangle,
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

type InvoiceStatus = "DRAFT" | "ISSUED" | "PAID" | "VOID" | "OVERDUE";
type DeliveryStatus = "PENDING" | "SENT" | "FAILED";

type InvoiceItem = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  currency: string;
  total: string;
  customerEmail: string | null;
  customerWallet: string | null;
  issuedAt: string | null;
  createdAt: string;
  deliveries: Array<{
    id: string;
    status: DeliveryStatus;
    createdAt: string;
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

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  if (status === "PAID") {
    return (
      <Badge className="bg-success/10 text-success border-success/20">
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
      <Badge className="bg-accent/10 text-accent border-accent/20">
        ISSUED
      </Badge>
    );
  }
  return <Badge variant="secondary">DRAFT</Badge>;
}

function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  if (status === "SENT") {
    return (
      <Badge className="bg-success/10 text-success border-success/20 text-xs">
        Sent
      </Badge>
    );
  }
  if (status === "FAILED") {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <AlertTriangle className="w-3 h-3" />
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

export function InvoicesSection() {
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | InvoiceStatus>("ALL");
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
  }, [query, status]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const rows = useMemo(() => invoices, [invoices]);

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
          <CardTitle className="text-base font-medium">
            Invoice Center
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchInvoices}
              disabled={loading}
            >
              <RefreshCw
                className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
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

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
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
                    colSpan={7}
                    className="text-center text-muted-foreground py-8"
                  >
                    Loading invoices...
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground py-8"
                  >
                    No invoices found.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                rows.map((invoice) => {
                  const latestDelivery = invoice.deliveries[0];
                  const transitions = STATUS_TRANSITIONS[invoice.status] ?? [];
                  const isBusy = busyId === invoice.id;

                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">
                        {invoice.number || invoice.id.slice(0, 10)}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate">
                        {invoice.customerEmail ||
                          invoice.customerWallet ||
                          "N/A"}
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
                          <span className="text-xs text-muted-foreground">
                            None
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          {transitions.length > 0 && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isBusy}
                                >
                                  Mark
                                  <ChevronDown className="w-3 h-3 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {transitions.map((target) => (
                                  <DropdownMenuItem
                                    key={target}
                                    onClick={() =>
                                      handleMarkStatus(invoice.id, target)
                                    }
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
                            onClick={() => handleDownload(invoice.id)}
                          >
                            <Download className="w-4 h-4 mr-1" />
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
                            onClick={() => handleResend(invoice.id)}
                          >
                            <Send className="w-4 h-4 mr-1" />
                            {latestDelivery?.status === "FAILED"
                              ? "Retry"
                              : "Resend"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
