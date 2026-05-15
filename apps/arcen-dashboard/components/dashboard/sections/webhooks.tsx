"use client";

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
import { Label } from "@/components/ui/label";
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
  Webhook,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  Play,
  ChevronDown,
  ChevronRight,
  Info,
  Eye,
  EyeOff,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";
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

  const statusClass =
    entry.status === "delivered"
      ? "bg-success/10 text-success border-success/20"
      : entry.status === "failed"
        ? "bg-destructive/10 text-destructive border-destructive/20"
        : "bg-warning/10 text-warning border-warning/20";

  const relTime = (() => {
    const diff = Date.now() - new Date(entry.deliveredAt).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return new Date(entry.deliveredAt).toLocaleDateString();
  })();

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        className="w-full grid grid-cols-[20px,1fr,auto,auto] sm:grid-cols-[20px,1fr,90px,60px,80px,60px] gap-3 py-3 px-1 text-sm items-center hover:bg-secondary/30 transition-colors rounded-sm text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-muted-foreground">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </span>
        <span className="font-mono text-xs text-foreground truncate">
          {entry.event}
        </span>
        <Badge
          variant="secondary"
          className={`text-xs ${statusClass} justify-center`}
        >
          {entry.status}
        </Badge>
        <span className="text-xs text-muted-foreground text-center hidden sm:block">
          {entry.statusCode ?? "—"}
        </span>
        <span className="text-xs text-muted-foreground text-right hidden sm:block">
          {relTime}
        </span>
        <span className="text-xs text-muted-foreground text-right hidden sm:block">
          {entry.attemptNumber > 1 ? (
            <span className="text-warning">
              {entry.attemptNumber - 1} retries
            </span>
          ) : (
            "—"
          )}
        </span>
      </button>

      {expanded && (
        <div className="mx-1 mb-3 rounded-lg bg-secondary/30 border border-border overflow-hidden">
          {/* URL */}
          {entry.url ? (
            <div className="px-4 py-3 border-b border-border/50">
              <p className="text-xs text-muted-foreground mb-1">Endpoint</p>
              <code className="text-xs text-foreground break-all">
                {entry.url}
              </code>
            </div>
          ) : null}

          {/* Payload */}
          {entry.payload ? (
            <div className="px-4 py-3 border-b border-border/50">
              <p className="text-xs text-muted-foreground mb-2">
                Request Payload
              </p>
              <pre className="text-xs text-foreground/80 overflow-x-auto max-h-48 leading-relaxed">
                {JSON.stringify(entry.payload, null, 2)}
              </pre>
            </div>
          ) : null}

          {/* Error */}
          {entry.error ? (
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground mb-1">Error</p>
              <p className="text-xs text-destructive">{entry.error}</p>
            </div>
          ) : null}

          {entry.durationMs ? (
            <div className="px-4 py-2 bg-secondary/30">
              <p className="text-xs text-muted-foreground">
                Delivered in {entry.durationMs}ms
                {entry.attemptNumber > 1
                  ? ` after ${entry.attemptNumber} attempts`
                  : null}
              </p>
            </div>
          ) : null}
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

  // Load existing config
  useEffect(() => {
    fetch("/api/provider/webhooks")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WebhookConfig | null) => {
        if (!data) return;
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
        setHasSecret(data.hasSecret);
        if (data.eventSubscriptions?.length > 0) {
          // Merge saved state with defaults (preserve any new events)
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
      const res = await fetch("/api/webhooks/log?limit=50");
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
      // Facilitator may not be running in dev
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
        // Allow clearing the webhook configuration.
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
      toast.error("Generate a signing secret before saving webhook events");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/provider/webhooks", {
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
      const res = await fetch("/api/provider/webhooks/secret", {
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
      const res = await fetch("/api/webhooks/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl.trim() }),
      });
      const data = (await res.json()) as TestResult;
      setTestResult(data);
      if (data.ok) {
        toast.success("Test webhook delivered");
        // Refresh log after short delay
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

  return (
    <div className="space-y-6">
      {/* Endpoint + Events */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Webhook className="w-4 h-4" />
            Webhook Setup
          </CardTitle>
          <CardDescription>
            Set the destination URL and explicitly tick which events ArcenPay
            should deliver. Webhooks are only sent for the events selected here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="webhookUrl">Endpoint URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="webhookUrl"
                    placeholder="https://api.yourapp.com/webhooks/arcenpay"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="bg-secondary border-border focus:border-accent font-mono text-sm flex-1"
                  />
                  {webhookUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(webhookUrl);
                        setUrlCopied(true);
                        setTimeout(() => setUrlCopied(false), 2000);
                      }}
                    >
                      {urlCopied ? (
                        <Check className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  ArcenPay signs each POST with{" "}
                  <code className="text-foreground">X-ArcenPay-Signature</code>{" "}
                  and only delivers to HTTPS endpoints.
                </p>
                {urlIsHttp && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Webhook URL must use HTTPS — http:// is not accepted
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Delivery readiness
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      A webhook is active only when URL, signing secret, and at
                      least one event are configured.
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={
                      canDisableWebhookSetup || canSaveWebhookSetup
                        ? "bg-success/10 text-success border-success/20"
                        : "bg-warning/10 text-warning border-warning/20"
                    }
                  >
                    {canDisableWebhookSetup
                      ? "Disabled"
                      : canSaveWebhookSetup
                        ? "Ready"
                        : "Setup needed"}
                  </Badge>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !canSaveWebhookSetup}
                  size="sm"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5 mr-2" />
                      Save Webhook Setup
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={isTesting || !normalizedWebhookUrl || !hasSecret}
                >
                  {isTesting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 mr-2" />
                      Send Test
                    </>
                  )}
                </Button>
              </div>

              {/* Test result — immediately visible below the buttons */}
              {testResult && (
                <div
                  className={`flex items-start gap-3 p-4 rounded-lg border text-sm ${
                    testResult.ok
                      ? "bg-success/5 border-success/20"
                      : "bg-destructive/5 border-destructive/20"
                  }`}
                >
                  {testResult.ok ? (
                    <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1 min-w-0">
                    <p
                      className={
                        testResult.ok ? "text-success" : "text-destructive"
                      }
                    >
                      {testResult.ok
                        ? `Delivered — HTTP ${testResult.status ?? 200}`
                        : (testResult.message ??
                          testResult.error ??
                          "Delivery failed")}
                    </p>
                    {testResult.ok && (
                      <p className="text-xs text-muted-foreground">
                        Check your server logs or expand the delivery below to see
                        the request details.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {!hasSecret && (
                <p className="text-xs text-muted-foreground">
                  Generate a signing secret before saving webhook events or
                  sending test deliveries.
                </p>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    Select Events
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tick the events that should trigger a delivery.
                  </p>
                </div>
                <Badge variant="secondary">
                  {enabledCount}/{events.length} selected
                </Badge>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() =>
                    setEvents((prev) =>
                      prev.map((e) => ({ ...e, enabled: true })),
                    )
                  }
                >
                  Select all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() =>
                    setEvents((prev) =>
                      prev.map((e) => ({ ...e, enabled: false })),
                    )
                  }
                >
                  Clear all
                </Button>
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                {events.map((event, idx) => (
                  <label
                    key={event.id}
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer bg-card hover:bg-secondary/30 transition-colors ${idx < events.length - 1 ? "border-b border-border/60" : ""}`}
                  >
                    <Checkbox
                      checked={event.enabled}
                      onCheckedChange={() => toggleEvent(event.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {event.label}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {event.description}
                      </p>
                      <code className="text-[11px] text-muted-foreground/70 mt-1 block">
                        {event.id}
                      </code>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signing Secret */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Eye className="w-4 h-4" />
            Signing Secret
          </CardTitle>
          <CardDescription>
            ArcenPay signs every webhook payload with HMAC-SHA256 using this
            secret. On your server, verify the{" "}
            <code className="text-foreground">X-ArcenPay-Signature</code> header
            to confirm authenticity. The secret is shown <strong>once</strong> —
            store it securely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current status */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 border border-border">
            <div>
              <p className="text-sm font-medium text-foreground">
                Signing Secret
              </p>
              {hasSecret ? (
                <code className="text-xs text-chart-1 font-mono mt-1 block">
                  whsec_••••••••••••••••••••••••••••••••
                </code>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  No secret configured — outbound webhooks are blocked until you
                  generate one
                </p>
              )}
            </div>
            <Badge
              variant="secondary"
              className={
                hasSecret
                  ? "bg-success/10 text-success border-success/20"
                  : "bg-muted/50 text-muted-foreground border-border"
              }
            >
              {hasSecret ? "Active" : "Not set"}
            </Badge>
          </div>

          {/* Newly generated secret — show once */}
          {newSecret && (
            <div className="space-y-2 p-4 rounded-xl border border-warning/30 bg-warning/5">
              <p className="text-xs font-semibold text-warning flex items-center gap-1.5">
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
                    <Check className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this in your server to verify webhook signatures:
              </p>
              <pre className="text-xs text-foreground/80 bg-secondary/50 px-3 py-2 rounded-lg border border-border overflow-x-auto">
                {`const sig = createHmac('sha256', '${newSecret.slice(0, 20)}…')
  .update(rawBody)
  .digest('hex');
const valid = sig === req.headers['x-arcenpay-signature'].replace('sha256=', '');`}
              </pre>
            </div>
          )}

          {/* Action buttons */}
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
                  Generating…
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
                Rotating invalidates the current secret immediately.
              </p>
            )}
          </div>

          {/* Verification hint */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
            <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Every outbound webhook includes headers:{" "}
              <code className="text-foreground">X-ArcenPay-Event</code>,{" "}
              <code className="text-foreground">X-ArcenPay-Timestamp</code>,{" "}
              <code className="text-foreground">X-ArcenPay-Signature</code>.
              Retry policy: exponential backoff, up to 5 attempts over 24 hours.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Rotate confirm dialog */}
      <AlertDialog open={showSecretConfirm} onOpenChange={setShowSecretConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasSecret
                ? "Rotate Signing Secret?"
                : "Generate Signing Secret?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasSecret
                ? "This will immediately invalidate the current signing secret. Any server still using the old secret will start rejecting webhooks."
                : "A new signing secret will be generated. You will only see it once — copy it to your server immediately."}
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

      {/* Delivery Logs */}
      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-medium">
              Delivery Logs
            </CardTitle>
            <CardDescription>
              Click any row to expand request details, payload, and error info.
              Last 50 deliveries.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadDeliveries}
            disabled={loadingLog}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1.5 ${loadingLog ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {logWarning && (
            <div className="mb-4 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
              {logWarning}
            </div>
          )}
          {deliveries.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <EyeOff className="w-8 h-8 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">
                {loadingLog
                  ? "Loading deliveries…"
                  : "No webhook deliveries yet. Configure an endpoint above and send a test."}
              </p>
            </div>
          ) : (
            <div>
              {/* Table header */}
              <div className="grid grid-cols-[20px,1fr,auto,auto] sm:grid-cols-[20px,1fr,90px,60px,80px,60px] gap-3 pb-2 border-b border-border text-xs text-muted-foreground font-medium px-1">
                <span />
                <span>Event</span>
                <span>Status</span>
                <span className="sm:hidden" />
                <span className="hidden sm:block text-center">HTTP</span>
                <span className="hidden sm:block text-right">Time</span>
                <span className="hidden sm:block text-right">Retries</span>
              </div>
              <div>
                {deliveries.map((entry) => (
                  <DeliveryRow key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Integration snippet */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base font-medium">
            Verify Webhooks on Your Server
          </CardTitle>
          <CardDescription>
            Use this snippet to verify that incoming webhooks are genuinely from
            ArcenPay.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 bg-secondary/50 border-b border-border text-xs text-muted-foreground font-medium">
              Node.js / Express
            </div>
            <pre className="px-4 py-4 text-xs text-foreground/80 overflow-x-auto leading-relaxed">
              {`import { createHmac } from 'crypto';

app.post('/webhooks/arcenpay', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-arcenpay-signature']; // "sha256=<hex>"
  const timestamp  = req.headers['x-arcenpay-timestamp'];
  const event      = req.headers['x-arcenpay-event'];

  // Verify signature
  const expected = 'sha256=' + createHmac('sha256', process.env.ARCENPAY_WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');

  if (signature !== expected) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = JSON.parse(req.body);
  console.log('Received event:', event, payload);

  res.json({ received: true });
});`}
            </pre>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 bg-secondary/50 border-b border-border text-xs text-muted-foreground font-medium">
              Next.js App Router (route.ts)
            </div>
            <pre className="px-4 py-4 text-xs text-foreground/80 overflow-x-auto leading-relaxed">
              {`import { createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-arcenpay-signature') ?? '';

  const expected = 'sha256=' + createHmac('sha256', process.env.ARCENPAY_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest('hex');

  if (signature !== expected) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  // handle payload.event ...
  return NextResponse.json({ received: true });
}`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
