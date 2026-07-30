"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Activity, RefreshCw, Filter, ChevronDown, Zap, User, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SkeletonTable } from "@/components/ui/skeleton";

interface EventRecord {
  id: string;
  eventType: string;
  name: string | null;
  companyId: string | null;
  userId: string | null;
  traits: Record<string, unknown>;
  sentAt: string;
  company?: {
    name: string | null;
    walletAddress: string | null;
    email?: string | null;
    externalId?: string | null;
  } | null;
  user?: {
    id: string;
    name: string | null;
    email: string | null;
    walletAddress: string | null;
    externalId: string | null;
  } | null;
}

function trimTo(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function getCompanyLabel(event: EventRecord): string | null {
  const label = firstNonEmpty(
    event.company?.name,
    event.company?.email,
    event.company?.walletAddress,
    event.company?.externalId,
    event.companyId,
  );
  return label ? trimTo(label, 28) : null;
}

function getUserLabel(event: EventRecord): string | null {
  const label = firstNonEmpty(
    event.user?.name,
    event.user?.email,
    event.user?.walletAddress,
    event.user?.externalId,
    event.userId,
  );
  return label ? trimTo(label, 24) : null;
}

function EventTypeBadge({ type, name }: { type: string; name?: string | null }) {
  if (type === "track") {
    return (
      <Badge className="bg-blue-100 text-foreground dark:bg-blue-950 dark:text-foreground text-xs">
        <Zap className="h-3 w-3 mr-1" /> {name ?? "track"}
      </Badge>
    );
  }
  if (type === "identify") {
    return (
      <Badge className="bg-purple-100 text-foreground dark:bg-purple-950 dark:text-foreground text-xs">
        <User className="h-3 w-3 mr-1" /> identify
      </Badge>
    );
  }
  if (type === "flag_check") {
    return (
      <Badge className="bg-green-100 text-foreground dark:bg-green-950 dark:text-foreground text-xs">
        <Flag className="h-3 w-3 mr-1" /> {name ?? "flag_check"}
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-xs">{type}</Badge>;
}

function EventRow({ event }: { event: EventRecord }) {
  const [expanded, setExpanded] = useState(false);
  const hasTraits = Object.keys(event.traits).length > 0;

  return (
    <>
      <tr
        className={`border-b border-border/50 hover:bg-muted/20 ${hasTraits ? "cursor-pointer" : ""}`}
        onClick={() => hasTraits && setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <EventTypeBadge type={event.eventType} name={event.name} />
        </td>
        <td className="px-4 py-3 text-sm">
          {getCompanyLabel(event) ?? <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {getUserLabel(event) ?? "—"}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {new Date(event.sentAt).toLocaleString()}
        </td>
        <td className="px-4 py-3">
          {hasTraits && (
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
          )}
        </td>
      </tr>
      {expanded && hasTraits && (
        <tr className="bg-muted/10 border-b border-border/30">
          <td colSpan={5} className="px-4 py-2">
            <pre className="text-xs text-muted-foreground overflow-x-auto">
              {JSON.stringify(event.traits, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

export function EventsStreamSection() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (filterType !== "all") params.set("eventType", filterType);
      const res = await fetch(`/api/v1/events?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { data: EventRecord[] };
        setEvents(data.data);
      }
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => {
    fetchEvents();
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchEvents, 5_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchEvents, autoRefresh]);

  return (
    <div className="space-y-6">
      {/* Controls row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {["all", "track", "identify", "flag_check"].map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterType === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {t === "all" ? "All" : t === "flag_check" ? "Flag Check" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors ${
              autoRefresh
                ? "border-border bg-secondary text-foreground dark:text-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            <Activity className={`h-3 w-3 ${autoRefresh ? "animate-pulse" : ""}`} />
            {autoRefresh ? "Live" : "Paused"}
          </button>
          <Button variant="outline" size="sm" onClick={fetchEvents} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Event table */}
      <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Event</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Company</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">User</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
              <th className="px-4 py-3 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {loading ? (
              <tr><td colSpan={5}><SkeletonTable rows={5} cols={5} /></td></tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-14 text-center">
                  <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium mb-1">No events yet</p>
                  <p className="text-xs text-muted-foreground">Send events via <code className="bg-muted px-1 rounded">/api/v1/events</code> to see them here.</p>
                </td>
              </tr>
            ) : (
              events.map((e) => <EventRow key={e.id} event={e} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Quick reference */}
      <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Quick Reference</p>
        <pre className="text-xs text-muted-foreground overflow-x-auto leading-relaxed">
{`POST /api/v1/events
Authorization: Bearer api_xxx
{
  "event_type": "track",
  "name": "scan"
}`}
        </pre>
      </div>
    </div>
  );
}
