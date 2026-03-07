"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, RefreshCw, Download, Terminal, User, Cpu } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ActorType = "USER" | "API" | "SYSTEM";

type AuditEntry = {
  id: string;
  createdAt: string;
  actorType: ActorType;
  actorUserId: string | null;
  actorAddress: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
};

function ActorBadge({ type }: { type: ActorType }) {
  if (type === "USER") {
    return (
      <Badge className="gap-1 bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
        <User className="w-3 h-3" />
        User
      </Badge>
    );
  }
  if (type === "API") {
    return (
      <Badge className="gap-1 bg-amber-500/10 text-amber-400 border-amber-500/20">
        <Cpu className="w-3 h-3" />
        API
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-slate-500/10 text-slate-400 border-slate-500/20">
      <Terminal className="w-3 h-3" />
      System
    </Badge>
  );
}

function truncate(value: string | null | undefined, len = 22): string {
  if (!value) return "—";
  return value.length > len ? `${value.slice(0, len)}…` : value;
}

export function AuditLogSection() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [actionFilter, setActionFilter] = useState("");
  const [actorType, setActorType] = useState<"ALL" | ActorType>("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  function buildParams(cursor?: string): URLSearchParams {
    const p = new URLSearchParams();
    if (actionFilter.trim()) p.set("action", actionFilter.trim());
    if (actorType !== "ALL") p.set("actorType", actorType);
    if (fromDate) p.set("from", new Date(fromDate).toISOString());
    if (toDate) {
      // Include the full end day
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      p.set("to", end.toISOString());
    }
    if (cursor) p.set("cursor", cursor);
    return p;
  }

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setNextCursor(null);
    try {
      const res = await fetch(`/api/audit-log?${buildParams().toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load audit log");
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load audit log",
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, actorType, fromDate, toDate]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/audit-log?${buildParams(nextCursor).toString()}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load more");
      setEntries((prev) => [
        ...prev,
        ...(Array.isArray(data.entries) ? data.entries : []),
      ]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = buildParams();
      params.set("format", "csv");
      params.set("limit", "200");
      const res = await fetch(`/api/audit-log?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base font-medium">Audit Log</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting || loading}
            >
              <Download className="w-4 h-4 mr-2" />
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchEntries}
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
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                placeholder="Filter by action (e.g. invoice.create)"
                className="pl-9"
              />
            </div>
            <select
              value={actorType}
              onChange={(e) =>
                setActorType(e.target.value as "ALL" | ActorType)
              }
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="ALL">All actors</option>
              <option value="USER">User</option>
              <option value="API">API</option>
              <option value="SYSTEM">System</option>
            </select>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-36"
              title="From date"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-36"
              title="To date"
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Identity</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    Loading audit log…
                  </TableCell>
                </TableRow>
              )}
              {!loading && entries.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    No audit events found.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <ActorBadge type={entry.actorType} />
                    </TableCell>
                    <TableCell
                      className="text-xs font-mono max-w-[160px] truncate"
                      title={entry.actorUserId ?? entry.actorAddress ?? ""}
                    >
                      {truncate(entry.actorUserId ?? entry.actorAddress)}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {entry.action}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.resourceType}
                      {entry.resourceId && (
                        <span className="ml-1 font-mono text-muted-foreground/60">
                          {truncate(entry.resourceId, 12)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {entry.ip ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
