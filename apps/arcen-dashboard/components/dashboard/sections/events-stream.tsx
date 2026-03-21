"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Activity, RefreshCw, Filter, ChevronDown, Zap, User, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface EventRecord {
  id: string;
  eventType: string;
  name: string | null;
  companyId: string | null;
  userId: string | null;
  traits: Record<string, unknown>;
  sentAt: string;
  company?: { name: string; walletAddress: string | null } | null;
}

function EventTypeBadge({ type, name }: { type: string; name?: string | null }) {
  if (type === "track") {
    return (
      <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-xs">
        <Zap className="h-3 w-3 mr-1" /> {name ?? "track"}
      </Badge>
    );
  }
  if (type === "identify") {
    return (
      <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 text-xs">
        <User className="h-3 w-3 mr-1" /> identify
      </Badge>
    );
  }
  if (type === "flag_check") {
    return (
      <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 text-xs">
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
          {event.company?.name ?? event.companyId ?? <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {event.userId ? event.userId.slice(0, 16) + "..." : "—"}
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
      const res = await fetch(`/api/v1/events?${params}`);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Event Stream</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time feed of track, identify, and flag check events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors ${
              autoRefresh
                ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-400"
                : "border-border text-muted-foreground"
            }`}
          >
            <Activity className={`h-3 w-3 ${autoRefresh ? "animate-pulse" : ""}`} />
            {autoRefresh ? "Live" : "Paused"}
          </button>
          <Button variant="outline" size="sm" onClick={fetchEvents} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {["all", "track", "identify", "flag_check"].map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterType === t
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {t === "all" ? "All" : t === "flag_check" ? "Flag Check" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Event table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Event</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Company</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading events...</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                No events yet. Start sending events via the /api/v1/events endpoint.
              </td></tr>
            ) : (
              events.map((e) => <EventRow key={e.id} event={e} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Quick reference */}
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">Quick Reference — Send a track event:</p>
        <pre className="text-xs text-muted-foreground overflow-x-auto">
{`POST /api/v1/events
Authorization: Bearer api_xxx
{
  "event_type": "track",
  "name": "scan",
  "company": { "wallet": "0x..." }
}`}
        </pre>
      </div>
    </div>
  );
}
