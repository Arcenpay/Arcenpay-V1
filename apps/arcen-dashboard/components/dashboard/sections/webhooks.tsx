"use client";
import { apiFetch } from "@/lib/api-client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  Play,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  RotateCw,
  Pencil,
  Link2,
  ListFilter,
  Activity,
  FileText,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RotateCcw,
  Filter,
  Clock,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CANONICAL_WEBHOOK_EVENTS } from "@/lib/webhook-events";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WebhookConfig {
  webhookUrl: string | null;
  hasSecret: boolean;
  eventSubscriptions: EventSub[];
}

interface EventSub {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface DeliveryEntry {
  id: string;
  event: string;
  status: "delivered" | "failed" | "pending";
  statusCode?: number;
  attemptNumber: number;
  deliveredAt: string;
  durationMs?: number;
  url?: string;
  error?: string;
  payload?: unknown;
}

interface TestResult {
  ok: boolean;
  status?: number;
  message?: string;
  error?: string;
}

interface DeliveryLogResponse {
  entries?: Record<string, unknown>[];
  degraded?: boolean;
  message?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_EVENTS: EventSub[] = CANONICAL_WEBHOOK_EVENTS.map((event) => ({
  ...event,
  enabled: false,
}));

// ─── Delivery Log Row ─────────────────────────────────────────────────────────

function DeliveryRow({ entry }: { entry: DeliveryEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        {expanded ? (
          <>
            <ChevronUp className="w-3 h-3" /> Hide
          </>
        ) : (
          <>
            <ChevronDown className="w-3 h-3" /> Details
          </>
        )}
      </button>
      
      {expanded && (
        <div className="mt-3 space-y-3">
          {entry.url && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Endpoint</p>
              <code className="text-xs text-foreground break-all">{entry.url}</code>
            </div>
          )}
          {entry.payload !== undefined && entry.payload !== null && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Payload</p>
              <pre className="text-xs text-foreground/80 overflow-x-auto max-h-48 leading-relaxed bg-secondary/50 p-2 rounded">
                {JSON.stringify(entry.payload, null, 2)}
              </pre>
            </div>
          )}
          {entry.error && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Error</p>
              <p className="text-xs text-destructive">{entry.error}</p>
            </div>
          )}
          {entry.durationMs && (
            <p className="text-xs text-muted-foreground">
              Delivered in {entry.durationMs}ms
              {entry.attemptNumber > 1 ? ` after ${entry.attemptNumber} attempts` : null}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Section ─────────────────────────────────────────────────────────────

export function WebhooksSection() {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [showSecretConfirm, setShowSecretConfirm] = useState(false);
  const [events, setEvents] = useState<EventSub[]>(DEFAULT_EVENTS);
  const [isSaving, setIsSaving] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [deliveries, setDeliveries] = useState<DeliveryEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [logWarning, setLogWarning] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "delivered" | "failed" | "pending">("all");
  const [mainTab, setMainTab] = useState<"endpoints" | "events" | "logs" | "activity">("endpoints");
  const [subTab, setSubTab] = useState<"overview" | "testing" | "advanced">("overview");
  const [showAttempts, setShowAttempts] = useState(true);
  const [showEventsSidebar, setShowEventsSidebar] = useState(true);
  const [showSecretSidebar, setShowSecretSidebar] = useState(false);
  const [isEditingUrl, setIsEditingUrl] = useState(false);

  // Load existing config
  useEffect(() => {
    apiFetch("/api/provider/webhooks")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WebhookConfig | null) => {
        if (!data) return;
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
        setHasSecret(data.hasSecret);
        if (data.eventSubscriptions?.length > 0) {
          setEvents((prev) =>
            prev.map((e) => {
              const saved = data.eventSubscriptions.find((s) => s.id === e.id);
              return saved ? { ...e, enabled: saved.enabled } : e;
            }),
          );
        }
      })
      .catch(() => {});
  }, []);

  const loadDeliveries = useCallback(async () => {
    setLoadingLog(true);
    try {
      const res = await apiFetch("/api/webhooks/log?limit=50");
      if (!res.ok) return;
      const data = (await res.json()) as DeliveryLogResponse;
      const rows: DeliveryEntry[] = (
        Array.isArray(data.entries) ? data.entries : []
      ).map((e: Record<string, unknown>, i: number) => ({
        id: String(e.id ?? `entry-${i}`),
        event: String(e.event ?? e.eventType ?? "unknown"),
        status:
          e.success === true
            ? "delivered"
            : e.success === false
              ? "failed"
              : "pending",
        statusCode: e.statusCode ? Number(e.statusCode) : undefined,
        attemptNumber: Math.max(1, Number(e.attemptNumber ?? 1)),
        deliveredAt: String(
          e.deliveredAt ?? e.createdAt ?? new Date().toISOString(),
        ),
        durationMs: e.durationMs ? Number(e.durationMs) : undefined,
        url: e.url ? String(e.url) : undefined,
        error: e.error ? String(e.error) : undefined,
        payload: e.payload ?? undefined,
      }));
      setDeliveries(rows);
      setLogWarning(
        data.degraded
          ? (data.message ??
              "Webhook delivery history is temporarily unavailable.")
          : null,
      );
    } catch {
      setLogWarning("Webhook delivery history is temporarily unavailable.");
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  const urlIsHttp =
    webhookUrl.trim().length > 0 &&
    webhookUrl.trim().startsWith("http://") &&
    !webhookUrl.trim().startsWith("https://");
  const enabledCount = events.filter((e) => e.enabled).length;
  const normalizedWebhookUrl = webhookUrl.trim();
  const canDisableWebhookSetup =
    !normalizedWebhookUrl && enabledCount === 0;
  const canSaveWebhookSetup =
    canDisableWebhookSetup ||
    (Boolean(normalizedWebhookUrl) &&
      enabledCount > 0 &&
      hasSecret &&
      !urlIsHttp);

  const handleSave = async () => {
    if (urlIsHttp) {
      toast.error("Webhook URL must use HTTPS");
      return;
    }
    if (!normalizedWebhookUrl) {
      if (enabledCount === 0) {
        // Allow clearing
      } else {
        toast.error("Enter a webhook URL first");
        return;
      }
    }
    if (enabledCount === 0 && normalizedWebhookUrl) {
      toast.error("Select at least one webhook event");
      return;
    }
    if (!hasSecret && normalizedWebhookUrl) {
      toast.error("Generate a signing secret before saving");
      return;
    }
    setIsSaving(true);
    try {
      const res = await apiFetch("/api/provider/webhooks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: normalizedWebhookUrl || null,
          eventSubscriptions: events,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Save failed");
      }
      toast.success("Webhook configuration saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save webhook configuration",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRotateSecret = async () => {
    setIsRotating(true);
    setNewSecret(null);
    try {
      const res = await apiFetch("/api/provider/webhooks/secret", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to rotate secret");
      const data = (await res.json()) as { secret: string };
      setNewSecret(data.secret);
      setHasSecret(true);
      setShowSecretConfirm(false);
    } catch {
      toast.error("Could not rotate signing secret");
    } finally {
      setIsRotating(false);
    }
  };

  const handleCopySecret = () => {
    if (!newSecret) return;
    navigator.clipboard.writeText(newSecret);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 2000);
  };

  const handleTest = async () => {
    if (!webhookUrl.trim()) {
      toast.error("Enter a webhook URL first");
      return;
    }
    if (urlIsHttp) {
      toast.error("Webhook URL must use HTTPS");
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch("/api/webhooks/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl.trim() }),
      });
      const data = (await res.json()) as TestResult;
      setTestResult(data);
      if (data.ok) {
        toast.success("Test webhook delivered");
        setTimeout(() => void loadDeliveries(), 1500);
      } else {
        toast.error(data.message ?? data.error ?? "Test failed");
      }
    } catch {
      setTestResult({
        ok: false,
        error: "Network error — could not reach webhook URL",
      });
      toast.error("Could not send test webhook");
    } finally {
      setIsTesting(false);
    }
  };

  const toggleEvent = (id: string) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)),
    );
  };

  // ─── Derived stats ─────────────────────────────────────────────────────────────
  const filteredDeliveries = statusFilter === "all" ? deliveries : deliveries.filter(d => d.status === statusFilter);
  const totalDeliveries = deliveries.length;
  const successfulDeliveries = deliveries.filter(d => d.status === "delivered").length;
  const failedDeliveries = deliveries.filter(d => d.status === "failed").length;
  const pendingDeliveries = deliveries.filter(d => d.status === "pending").length;
  const successRate = totalDeliveries > 0 ? Math.round((successfulDeliveries / totalDeliveries) * 100) : 0;
  const enabledEvents = events.filter(e => e.enabled);

  return (
    <div className="space-y-6 min-w-0">
      {/* ─── Top-level Tabs ─────────────────────────────────────────────────────── */}
      <div className="border-b border-border">
        <div className="flex gap-6">
          {([
            { id: "endpoints" as const, label: "Endpoints", icon: Link2 },
            { id: "events" as const, label: "Event Catalog", icon: ListFilter },
            { id: "logs" as const, label: "Logs", icon: FileText },
            { id: "activity" as const, label: "Activity", icon: Activity },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMainTab(id)}
              className={cn(
                "pb-3 text-sm font-medium transition-colors relative flex items-center gap-2",
                mainTab === id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
              {mainTab === id && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Endpoints Tab ──────────────────────────────────────────────────────── */}
      {mainTab === "endpoints" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-6">
          {/* Left Column */}
          <div className="space-y-6 min-w-0">
            {/* Breadcrumb + Endpoint URL */}
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                <span>Endpoints</span>
                <ChevronRight className="w-3 h-3" />
                <span className="text-foreground font-medium">Main</span>
              </div>
              <div className="flex items-center gap-3">
                {isEditingUrl ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://api.yourapp.com/webhooks/arcenpay"
                      className="bg-secondary border-border font-mono text-sm flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setIsEditingUrl(false);
                          void handleSave();
                        }
                        if (e.key === "Escape") setIsEditingUrl(false);
                      }}
                    />
                    <Button size="sm" onClick={() => { setIsEditingUrl(false); void handleSave(); }}>
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setIsEditingUrl(false)}>
                      <XCircle className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <code className="text-sm font-mono text-foreground truncate">
                      {webhookUrl || "No endpoint configured"}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingUrl(true)}
                      className="shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1.5" />
                      Edit
                    </Button>
                  </>
                )}
              </div>
              {urlIsHttp && (
                <p className="text-xs text-destructive flex items-center gap-1 mt-2">
                  <AlertTriangle className="w-3 h-3" />
                  Webhook URL must use HTTPS
                </p>
              )}
            </div>

            {/* Sub-tabs */}
            <div className="border-b border-border">
              <div className="flex gap-6">
                {([
                  { id: "overview" as const, label: "Overview" },
                  { id: "testing" as const, label: "Testing" },
                  { id: "advanced" as const, label: "Advanced" },
                ]).map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setSubTab(id)}
                    className={cn(
                      "pb-3 text-sm font-medium transition-colors relative",
                      subTab === id
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                    {subTab === id && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* ─── Overview Tab ─────────────────────────────────────────────── */}
            {subTab === "overview" && (
              <div className="space-y-6">
                {/* Description */}
                <div className="rounded-lg border border-border bg-card">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <p className="text-sm font-medium text-foreground">Description</p>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      Edit
                    </Button>
                  </div>
                  <div className="px-4 py-4">
                    <p className="text-sm text-muted-foreground">
                      {webhookUrl
                        ? "Endpoint configured"
                        : "No description"}
                    </p>
                  </div>
                </div>

                {/* Delivery Stats Card */}
                <Card className="border-border bg-card">
                  <CardContent className="p-4">
                    <p className="text-sm font-medium text-foreground mb-4">
                      Delivery Stats
                    </p>
                    {totalDeliveries > 0 ? (
                      <div className="space-y-4">
                        {/* Progress bar */}
                        <div className="h-3 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${successRate}%` }}
                          />
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-sm bg-emerald-500" />
                            <span className="text-muted-foreground">SUCCESS — {successfulDeliveries}</span>
                          </div>
                          {failedDeliveries > 0 && (
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-sm bg-red-500" />
                              <span className="text-muted-foreground">FAILED — {failedDeliveries}</span>
                            </div>
                          )}
                          {pendingDeliveries > 0 && (
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-sm bg-amber-500" />
                              <span className="text-muted-foreground">PENDING — {pendingDeliveries}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No deliveries yet. Send a test to see stats.
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Message Attempts Section */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <button
                      onClick={() => setShowAttempts(!showAttempts)}
                      className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-muted-foreground transition-colors"
                    >
                      <ChevronDown
                        className={cn(
                          "w-4 h-4 transition-transform",
                          !showAttempts && "-rotate-90"
                        )}
                      />
                      Message Attempts
                    </button>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadDeliveries}
                        disabled={loadingLog}
                        className="h-8 px-2.5"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", loadingLog && "animate-spin")} />
                      </Button>
                      <div className="flex items-center bg-secondary rounded-lg p-0.5">
                        {(["all", "delivered", "failed", "pending"] as const).map((status) => (
                          <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={cn(
                              "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                              statusFilter === status
                                ? "bg-card text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
                          </button>
                        ))}
                      </div>
                      <Button variant="outline" size="sm" className="h-8 px-2.5">
                        <Filter className="w-3.5 h-3.5 mr-1.5" />
                        Filters
                      </Button>
                    </div>
                  </div>

                  {showAttempts && (
                    <Card className="border-border bg-card overflow-hidden">
                      <CardContent className="p-0">
                        {logWarning && (
                          <div className="p-3 border-b border-border bg-secondary/50 text-xs text-muted-foreground">
                            {logWarning}
                          </div>
                        )}
                        {filteredDeliveries.length === 0 ? (
                          <div className="text-center py-10 space-y-2">
                            <EyeOff className="w-8 h-8 text-muted-foreground/30 mx-auto" />
                            <p className="text-sm text-muted-foreground">
                              {loadingLog
                                ? "Loading deliveries..."
                                : "No webhook deliveries yet."}
                            </p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-border">
                                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 w-32">STATUS</th>
                                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">EVENT TYPE</th>
                                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">MESSAGE ID</th>
                                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">TIMESTAMP</th>
                                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 w-16">REPLAY</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredDeliveries.map((entry) => (
                                  <tr
                                    key={entry.id}
                                    className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                                  >
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        {entry.status === "delivered" && (
                                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-500">
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                            <span className="text-xs font-medium">Succeeded</span>
                                          </div>
                                        )}
                                        {entry.status === "failed" && (
                                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/10 text-red-500">
                                            <XCircle className="w-3.5 h-3.5" />
                                            <span className="text-xs font-medium">Failed</span>
                                          </div>
                                        )}
                                        {entry.status === "pending" && (
                                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 text-amber-500">
                                            <HelpCircle className="w-3.5 h-3.5" />
                                            <span className="text-xs font-medium">Pending</span>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <code className="text-xs font-mono text-foreground">{entry.event}</code>
                                    </td>
                                    <td className="px-4 py-3">
                                      <code className="text-xs font-mono text-muted-foreground">
                                        {entry.id.slice(0, 12)}...
                                      </code>
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className="text-xs text-muted-foreground">
                                        {new Date(entry.deliveredAt).toLocaleString()}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 w-7 p-0"
                                        onClick={() => {
                                          toast.info("Replay not yet implemented");
                                        }}
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            )}

            {/* ─── Testing Tab ──────────────────────────────────────────────── */}
            {subTab === "testing" && (
              <div className="space-y-6">
                <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="text-base font-medium">Test Webhook</CardTitle>
                    <CardDescription>
                      Send a test payload to your endpoint to verify it works
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Button
                        onClick={handleTest}
                        disabled={isTesting || !normalizedWebhookUrl || !hasSecret}
                      >
                        {isTesting ? (
                          <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5 mr-2" />
                        )}
                        Send Test
                      </Button>
                    </div>
                    {testResult && (
                      <div
                        className={cn(
                          "flex items-start gap-3 p-4 rounded-lg border text-sm",
                          testResult.ok
                            ? "bg-secondary border-border"
                            : "bg-secondary border-border"
                        )}
                      >
                        {testResult.ok ? (
                          <Check className="w-4 h-4 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        )}
                        <div className="space-y-1 min-w-0">
                          <p className={testResult.ok ? "text-foreground" : "text-destructive"}>
                            {testResult.ok
                              ? `Delivered — HTTP ${testResult.status ?? 200}`
                              : (testResult.message ?? testResult.error ?? "Delivery failed")}
                          </p>
                          {testResult.ok && (
                            <p className="text-xs text-muted-foreground">
                              Check the Overview tab for the delivery details.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ─── Advanced Tab ─────────────────────────────────────────────── */}
            {subTab === "advanced" && (
              <div className="space-y-6">
                <Card className="border-border bg-card">
                  <CardHeader>
                    <CardTitle className="text-base font-medium">Signing Secret</CardTitle>
                    <CardDescription>
                      Rotate or regenerate your webhook signing secret
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 border border-border">
                      <div>
                        <p className="text-sm font-medium text-foreground">Current Secret</p>
                        {hasSecret ? (
                          <code className="text-xs font-mono mt-1 block text-muted-foreground">
                            whsec_••••••••••••••••••••••••••••••••
                          </code>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-1">No secret configured</p>
                        )}
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          hasSecret
                            ? "bg-secondary text-foreground border-border"
                            : "bg-muted/50 text-muted-foreground border-border"
                        }
                      >
                        {hasSecret ? "Active" : "Not set"}
                      </Badge>
                    </div>

                    {newSecret && (
                      <div className="space-y-2 p-4 rounded-xl border border-border bg-secondary">
                        <p className="text-xs font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Copy this secret now — it will not be shown again
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-xs font-mono text-foreground bg-secondary px-3 py-2.5 rounded-lg border border-border break-all">
                            {newSecret}
                          </code>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={handleCopySecret}
                          >
                            {secretCopied ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-1">
                      <Button
                        variant={hasSecret ? "outline" : "default"}
                        size="sm"
                        onClick={() => setShowSecretConfirm(true)}
                        disabled={isRotating}
                      >
                        {isRotating ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                            Generating
                          </>
                        ) : (
                          <>
                            <RotateCw className="w-3.5 h-3.5 mr-2" />
                            {hasSecret ? "Rotate Secret" : "Generate Secret"}
                          </>
                        )}
                      </Button>
                      {hasSecret && (
                        <p className="text-xs text-muted-foreground">
                          Rotating invalidates the current secret immediately
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="space-y-0 lg:sticky lg:top-4 lg:self-start">
            <Card className="border-border bg-card rounded-b-none">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge
                    variant="secondary"
                    className="bg-secondary text-foreground border-border"
                  >
                    {canSaveWebhookSetup ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card rounded-none border-t-0">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Creation Date</p>
                </div>
                <p className="text-xs text-foreground">{new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card rounded-none border-t-0">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Last Updated</p>
                </div>
                <p className="text-xs text-foreground">{new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card rounded-none border-t-0">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-foreground">Subscribed events</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => {
                      setMainTab("events");
                      setSubTab("overview");
                    }}
                  >
                    Edit
                  </Button>
                </div>
                {showEventsSidebar && (
                  <div className="space-y-2">
                    {enabledEvents.slice(0, 5).map((event) => (
                      <code key={event.id} className="text-xs text-muted-foreground block">
                        {event.id}
                      </code>
                    ))}
                    {enabledEvents.length > 5 && (
                      <p className="text-xs text-muted-foreground pl-2">
                        + {enabledEvents.length - 5} more
                      </p>
                    )}
                    {enabledEvents.length === 0 && (
                      <p className="text-xs text-muted-foreground">No events selected</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border bg-card rounded-t-none border-t-0">
              <CardContent className="p-4 space-y-4">
                <button
                  onClick={() => setShowSecretSidebar(!showSecretSidebar)}
                  className="flex items-center justify-between w-full"
                >
                  <p className="text-xs font-medium text-foreground">Signing Secret</p>
                  <ChevronDown
                    className={cn(
                      "w-3 h-3 text-muted-foreground transition-transform",
                      showSecretSidebar && "rotate-180"
                    )}
                  />
                </button>
                {showSecretSidebar && (
                  <div>
                    {hasSecret ? (
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-muted-foreground">
                          ••••••••••••••••
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => setShowSecretConfirm(true)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not configured</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ─── Event Catalog Tab ───────────────────────────────────────────────────── */}
      {mainTab === "events" && (
        <div className="space-y-6">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Event Catalog</CardTitle>
              <CardDescription>
                Browse and select events to subscribe to
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() =>
                      setEvents((prev) =>
                        prev.map((e) => ({ ...e, enabled: true }))
                      )
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() =>
                      setEvents((prev) =>
                        prev.map((e) => ({ ...e, enabled: false }))
                      )
                    }
                  >
                    Clear all
                  </Button>
                </div>
                <Badge variant="secondary">
                  {enabledCount}/{events.length} selected
                </Badge>
              </div>
              <div className="rounded-xl border border-border overflow-hidden">
                {events.map((event, idx) => (
                  <label
                    key={event.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 cursor-pointer bg-card hover:bg-secondary/30 transition-colors",
                      idx < events.length - 1 ? "border-b border-border/60" : ""
                    )}
                  >
                    <Checkbox
                      checked={event.enabled}
                      onCheckedChange={() => toggleEvent(event.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{event.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                      <code className="text-[11px] text-muted-foreground/70 mt-1 block">{event.id}</code>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !canSaveWebhookSetup}
                  size="sm"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                      Saving
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5 mr-2" />
                      Save Events
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Logs Tab ────────────────────────────────────────────────────────────── */}
      {mainTab === "logs" && (
        <div className="space-y-6">
          <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-medium">Delivery Logs</CardTitle>
                <CardDescription>Last 50 webhook deliveries</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadDeliveries}
                disabled={loadingLog}
              >
                <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loadingLog && "animate-spin")} />
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {logWarning && (
                <div className="p-4 border-b border-border bg-secondary/50 text-xs text-muted-foreground">
                  {logWarning}
                </div>
              )}
              {deliveries.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <EyeOff className="w-8 h-8 text-muted-foreground/30 mx-auto" />
                  <p className="text-sm text-muted-foreground">
                    {loadingLog ? "Loading deliveries..." : "No deliveries yet."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Event</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Date</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveries.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <code className="text-xs font-mono text-foreground">{entry.event}</code>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary" className="text-xs bg-secondary text-foreground border-border">
                              {entry.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-muted-foreground">
                              {new Date(entry.deliveredAt).toLocaleString()}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <DeliveryRow entry={entry} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Activity Tab ────────────────────────────────────────────────────────── */}
      {mainTab === "activity" && (
        <div className="space-y-6">
          <Card className="border-border bg-card">
            <CardContent className="p-8 text-center">
              <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Activity feed coming soon</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Dialogs ───────────────────────────────────────────────────────────── */}
      <AlertDialog open={showSecretConfirm} onOpenChange={setShowSecretConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasSecret ? "Rotate Signing Secret?" : "Generate Signing Secret?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasSecret
                ? "This will immediately invalidate the current signing secret."
                : "A new signing secret will be generated. You will only see it once."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleRotateSecret()}
              disabled={isRotating}
            >
              {hasSecret ? "Rotate Secret" : "Generate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
