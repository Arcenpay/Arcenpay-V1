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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
        className="w-full grid grid-cols-[20px,1fr,90px,60px,80px,60px] gap-3 py-3 px-1 text-sm items-center hover:bg-secondary/30 transition-colors rounded-sm text-left"
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
        <Badge variant="secondary" className={`text-xs ${statusClass} justify-center`}>
          {entry.status}
        </Badge>
        <span className="text-xs text-muted-foreground text-center">
          {entry.statusCode ?? "—"}
        </span>
        <span className="text-xs text-muted-foreground text-right">{relTime}</span>
        <span className="text-xs text-muted-foreground text-right">
          {entry.attemptNumber > 1 ? (
            <span className="text-warning">{entry.attemptNumber - 1} retries</span>
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
              <code className="text-xs text-foreground break-all">{entry.url}</code>
            </div>
          ) : null}

          {/* Payload */}
          {entry.payload ? (
            <div className="px-4 py-3 border-b border-border/50">
              <p className="text-xs text-muted-foreground mb-2">Request Payload</p>
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
                {entry.attemptNumber > 1 ? ` after ${entry.attemptNumber} attempts` : null}
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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/provider/webhooks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: webhookUrl.trim() || null,
          eventSubscriptions: events,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Webhook configuration saved");
    } catch {
      toast.error("Could not save webhook configuration");
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
      setTestResult({ ok: false, error: "Network error — could not reach webhook URL" });
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

  const enabledCount = events.filter((e) => e.enabled).length;

  return (
    <div className="space-y-6">
      {/* Endpoint + Test */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Webhook className="w-4 h-4" />
            Webhook Endpoint
          </CardTitle>
          <CardDescription>
            ArcenPay will send HTTP POST requests to this URL whenever subscribed
            events occur. Each request is signed with HMAC-SHA256 via the{" "}
            <code className="text-foreground">X-Arcen-Signature</code> header.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleSave}
              disabled={isSaving}
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
                  Save
                </>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={isTesting || !webhookUrl.trim()}
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

          {/* Test result inline */}
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
                    : (testResult.message ?? testResult.error ?? "Delivery failed")}
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
            <code className="text-foreground">X-Arcen-Signature</code> header
            to confirm authenticity. The secret is shown <strong>once</strong> — store it securely.
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
                  No secret configured — webhooks will be unsigned
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
const valid = sig === req.headers['x-arcen-signature'].replace('sha256=', '');`}
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
              <code className="text-foreground">X-Arcen-Event</code>,{" "}
              <code className="text-foreground">X-Arcen-Timestamp</code>,{" "}
              <code className="text-foreground">X-Arcen-Signature</code>. Retry
              policy: exponential backoff, up to 5 attempts over 24 hours.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Rotate confirm dialog */}
      <AlertDialog open={showSecretConfirm} onOpenChange={setShowSecretConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasSecret ? "Rotate Signing Secret?" : "Generate Signing Secret?"}
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

      {/* Event Subscriptions */}
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium">
                Event Subscriptions
              </CardTitle>
              <CardDescription>
                Choose which events trigger a webhook delivery.{" "}
                {enabledCount > 0 ? (
                  <span className="text-foreground font-medium">
                    {enabledCount} of {events.length} enabled
                  </span>
                ) : (
                  "None enabled — no webhooks will be sent."
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() =>
                  setEvents((prev) => prev.map((e) => ({ ...e, enabled: true })))
                }
              >
                All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() =>
                  setEvents((prev) => prev.map((e) => ({ ...e, enabled: false })))
                }
              >
                None
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr,64px] gap-4 pb-3 border-b border-border text-xs text-muted-foreground font-medium">
              <span>Event</span>
              <span className="text-center">Send</span>
            </div>
            {events.map((event, idx) => (
              <div
                key={event.id}
                className="grid grid-cols-[1fr,64px] gap-4 py-3.5 border-b border-border/50 last:border-0 animate-in fade-in slide-in-from-left-2 items-center"
                style={{ animationDelay: `${idx * 30}ms`, animationFillMode: "both" }}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {event.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {event.description}
                  </p>
                  <code className="text-xs text-muted-foreground/60 mt-0.5 block">
                    {event.id}
                  </code>
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={event.enabled}
                    onCheckedChange={() => toggleEvent(event.id)}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 mr-2" />
                  Save Subscriptions
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

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
              <div className="grid grid-cols-[20px,1fr,90px,60px,80px,60px] gap-3 pb-2 border-b border-border text-xs text-muted-foreground font-medium px-1">
                <span />
                <span>Event</span>
                <span>Status</span>
                <span className="text-center">HTTP</span>
                <span className="text-right">Time</span>
                <span className="text-right">Retries</span>
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
  const signature = req.headers['x-arcen-signature']; // "sha256=<hex>"
  const timestamp  = req.headers['x-arcen-timestamp'];
  const event      = req.headers['x-arcen-event'];

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
  const signature = req.headers.get('x-arcen-signature') ?? '';

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
