"use client";

import { useState, useEffect } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  User,
  Bell,
  Shield,
  Link2,
  Globe,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Fuel,
  Plus,
  Info,
} from "lucide-react";
import {
  useAccount,
  useChainId,
  useBalance,
  useSendTransaction,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseEther, isAddress } from "viem";
import { toast } from "sonner";
import { useContractAddresses } from "@/lib/contracts";
import { getBlockExplorerUrl } from "@/lib/format";

const NOTIFICATION_DEFAULTS = [
  {
    id: "new_subscriber",
    label: "New Subscriber",
    description: "When a new subscriber mints an NFT to your plan",
    email: false,
    webhook: false,
  },
  {
    id: "renewal",
    label: "Subscription Renewal",
    description: "When a subscription is successfully renewed",
    email: false,
    webhook: false,
  },
  {
    id: "cancellation",
    label: "Subscription Cancellation",
    description: "When a subscriber cancels their subscription",
    email: false,
    webhook: false,
  },
  {
    id: "payment_failed",
    label: "Payment Failed",
    description: "When an autopay billing attempt fails",
    email: false,
    webhook: false,
  },
  {
    id: "billing_settled",
    label: "Billing Settled",
    description: "When a zk proof is verified and usage is settled on-chain",
    email: false,
    webhook: false,
  },
  {
    id: "low_balance",
    label: "Low Session Balance",
    description: "When an agent's session vault drops below 20%",
    email: false,
    webhook: false,
  },
];

// Minimal ABI for SubscriptionRegistry public transport getters and setCrossChainTransports
const REGISTRY_GMP_ABI = [
  {
    name: "axelarTransport",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "ccipTransport",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "setCrossChainTransports",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "axelarTransport", type: "address" },
      { name: "ccipTransport", type: "address" },
    ],
    outputs: [],
  },
] as const;

interface WebhookLogEntry {
  id: string;
  eventType: string;
  status: "delivered" | "failed" | "pending";
  retries: number;
  createdAt: string;
  responseCode?: number;
}

function WebhookLogCard() {
  const [entries, setEntries] = useState<WebhookLogEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchLog = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/webhooks/log?limit=20");
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data.entries)
          ? data.entries
          : Array.isArray(data.log)
            ? data.log
            : [];
        const normalized: WebhookLogEntry[] = rows.map(
          (entry: Record<string, unknown>, index: number) => ({
            id: String(entry.id || `entry-${index}`),
            eventType: String(entry.event || entry.eventType || "unknown"),
            status:
              entry.success === true
                ? "delivered"
                : entry.success === false
                  ? "failed"
                  : "pending",
            retries: Math.max(
              0,
              Number(entry.attemptNumber || entry.retries || 1) - 1,
            ),
            createdAt:
              typeof entry.createdAt === "string"
                ? entry.createdAt
                : new Date(
                    Number(entry.deliveredAt || entry.createdAt || Date.now()),
                  ).toISOString(),
            responseCode:
              Number(entry.statusCode || entry.responseCode || 0) || undefined,
          }),
        );
        setEntries(normalized);
      }
    } catch {
      // Silent — facilitator may not be running in dev
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchLog();
  }, []);

  const statusColor = (status: string) => {
    if (status === "delivered")
      return "bg-success/10 text-success border-success/20";
    if (status === "failed")
      return "bg-destructive/10 text-destructive border-destructive/20";
    return "bg-warning/10 text-warning border-warning/20";
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base font-medium">
            Webhook Delivery Log
          </CardTitle>
          <CardDescription>
            Recent webhook delivery attempts with status and retry count
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchLog}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {isRefreshing
              ? "Loading..."
              : "No webhook deliveries yet. Configure a webhook URL above and trigger a test event."}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr,90px,90px,70px] gap-3 pb-2 border-b border-border text-xs text-muted-foreground font-medium">
              <span>Event</span>
              <span>Status</span>
              <span>Time</span>
              <span className="text-right">Retries</span>
            </div>
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[1fr,90px,90px,70px] gap-3 py-2.5 border-b border-border/50 last:border-0 text-sm items-center"
              >
                <span className="text-foreground font-mono text-xs truncate">
                  {entry.eventType}
                </span>
                <Badge
                  variant="secondary"
                  className={`text-xs ${statusColor(entry.status)}`}
                >
                  {entry.status}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </span>
                <span className="text-right text-muted-foreground text-xs">
                  {entry.retries}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main SettingsSection ──────────────────────────────────────────────────────

export function SettingsSection() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const contractAddresses = useContractAddresses();

  const [activeTab, setActiveTab] = useState("profile");
  const [notifications, setNotifications] = useState(NOTIFICATION_DEFAULTS);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [environmentMode, setEnvironmentMode] = useState<
    "DEVELOPMENT" | "PRODUCTION"
  >("DEVELOPMENT");

  // Profile
  const [providerName, setProviderName] = useState("");
  const [website, setWebsite] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // Webhook
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  // API key
  const [apiKeyPrefix, setApiKeyPrefix] = useState<string | null>(null);
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(
    null,
  );
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [generateKeySheetOpen, setGenerateKeySheetOpen] = useState(false);
  const [revokeKeySheetOpen, setRevokeKeySheetOpen] = useState(false);
  const [pendingDangerAction, setPendingDangerAction] = useState<{
    confirmTitle: string;
    confirmDesc: string;
    confirmLabel: string;
  } | null>(null);

  // GMP
  const [gmpTopUpAmount, setGmpTopUpAmount] = useState("");
  const [newAxelarTransport, setNewAxelarTransport] = useState("");
  const [newCcipTransport, setNewCcipTransport] = useState("");
  const [isSettingTransports, setIsSettingTransports] = useState(false);

  const registryAddress =
    contractAddresses.subscriptionRegistry as `0x${string}`;

  const { data: transportData, refetch: refetchTransports } = useReadContracts({
    contracts: [
      {
        address: registryAddress,
        abi: REGISTRY_GMP_ABI,
        functionName: "axelarTransport",
      },
      {
        address: registryAddress,
        abi: REGISTRY_GMP_ABI,
        functionName: "ccipTransport",
      },
    ],
    query: { enabled: isConnected && !!registryAddress },
  });

  const axelarTransportAddr = transportData?.[0]?.result as
    | `0x${string}`
    | undefined;
  const ccipTransportAddr = transportData?.[1]?.result as
    | `0x${string}`
    | undefined;
  const ZERO = "0x0000000000000000000000000000000000000000";
  const axelarConfigured =
    !!axelarTransportAddr && axelarTransportAddr !== ZERO;
  const ccipConfigured = !!ccipTransportAddr && ccipTransportAddr !== ZERO;

  const { writeContractAsync: writeSetTransports } = useWriteContract();
  const [setTransportsTxHash, setSetTransportsTxHash] = useState<
    `0x${string}` | undefined
  >();
  const { data: setTransportsReceipt } = useWaitForTransactionReceipt({
    hash: setTransportsTxHash,
    query: { enabled: !!setTransportsTxHash },
  });

  useEffect(() => {
    if (setTransportsReceipt) {
      toast.success("Cross-chain transports updated");
      setSetTransportsTxHash(undefined);
      setNewAxelarTransport("");
      setNewCcipTransport("");
      setIsSettingTransports(false);
      void refetchTransports();
    }
  }, [setTransportsReceipt, refetchTransports]);

  const handleSetTransports = async () => {
    const axelar = newAxelarTransport.trim() || ZERO;
    const ccip = newCcipTransport.trim() || ZERO;
    if (!isAddress(axelar) || !isAddress(ccip)) {
      toast.error(
        "Both addresses must be valid EVM addresses (or leave blank to clear)",
      );
      return;
    }
    setIsSettingTransports(true);
    try {
      const hash = await writeSetTransports({
        address: registryAddress,
        abi: REGISTRY_GMP_ABI,
        functionName: "setCrossChainTransports",
        args: [axelar as `0x${string}`, ccip as `0x${string}`],
      });
      setSetTransportsTxHash(hash);
      toast.info("Transaction submitted…");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Transaction failed");
      setIsSettingTransports(false);
    }
  };

  useEffect(() => {
    // Load all profile fields from the server — localStorage is no longer used
    fetch("/api/provider/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        if (!profile) return;
        if (profile.providerName) setProviderName(profile.providerName);
        if (profile.website) setWebsite(profile.website);
        if (profile.contactEmail) setContactEmail(profile.contactEmail);
        if (profile.webhookUrl) setWebhookUrl(profile.webhookUrl);
        if (profile.apiKeyPrefix) setApiKeyPrefix(profile.apiKeyPrefix);
      })
      .catch(() => {});
    // Load notification preferences from server (source of truth — not localStorage)
    fetch("/api/provider/notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (
          data?.notifications &&
          Array.isArray(data.notifications) &&
          data.notifications.length > 0
        ) {
          setNotifications(data.notifications);
        }
      })
      .catch(() => {});
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((team) => {
        if (!team) return;
        if (
          team.environmentMode === "DEVELOPMENT" ||
          team.environmentMode === "PRODUCTION"
        ) {
          setEnvironmentMode(team.environmentMode);
        }
      })
      .catch(() => {});
  }, []);

  const { data: gmpBalance } = useBalance({
    address: contractAddresses.subscriptionRegistry as `0x${string}`,
    query: { enabled: isConnected },
  });

  const { sendTransactionAsync } = useSendTransaction();

  const contractList = [
    {
      name: "PlanFactory",
      key: "planFactory" as const,
      description: "Creates and manages subscription plans",
    },
    {
      name: "SubscriptionRegistry",
      key: "subscriptionRegistry" as const,
      description: "NFT-based subscription management",
    },
    {
      name: "SessionVault",
      key: "sessionVault" as const,
      description: "Agent session fund storage",
    },
    {
      name: "FeeCollector",
      key: "feeCollector" as const,
      description: "Protocol fee collection",
    },
    {
      name: "ZKUsageVerifier",
      key: "zkUsageVerifier" as const,
      description: "zk-SNARK proof verification",
    },
    {
      name: "ERC7579AutopayModule",
      key: "autopayModule" as const,
      description: "Automated billing module",
    },
    ...(contractAddresses.mirrorRegistry
      ? [
          {
            name: "MirrorRegistry",
            key: "mirrorRegistry" as const,
            description: "Cross-chain entitlement sync",
          },
        ]
      : []),
  ] as Array<{
    name: string;
    key: keyof typeof contractAddresses;
    description: string;
  }>;

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/provider/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerName: providerName || undefined,
          website: website || undefined,
          contactEmail: contactEmail || undefined,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Profile saved");
    } catch {
      toast.error("Could not save profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSwitchEnvironment = async (
    nextMode: "DEVELOPMENT" | "PRODUCTION",
  ) => {
    if (nextMode === environmentMode) return;
    const confirmText = window.prompt(
      `Switch workspace mode to ${nextMode}? Type CONFIRM to continue.`,
      "",
    );
    if (confirmText !== "CONFIRM") {
      toast.error("Environment switch cancelled");
      return;
    }

    try {
      const chainIdHint = nextMode === "PRODUCTION" ? 8453 : 11155111;
      const res = await fetch("/api/environment/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environmentMode: nextMode,
          chainId: chainIdHint,
          confirmText,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Environment switch failed");
      }
      setEnvironmentMode(nextMode);
      toast.success(`Workspace now in ${nextMode} mode`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Environment switch failed",
      );
    }
  };

  const handleSaveWebhookConfig = async () => {
    setIsSaving(true);
    const notifyEmail = notifications.some((n) => n.email);
    const notifyWebhook = notifications.some((n) => n.webhook);
    try {
      const res = await fetch("/api/provider/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: webhookUrl || "",
          notifyEmail,
          notifyWebhook,
          // Only send if user has entered a new secret (min 16 chars)
          ...(webhookSecret.length >= 16 && {
            webhookSigningSecret: webhookSecret,
          }),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Webhook config saved");
    } catch {
      toast.error("Could not save webhook config");
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateApiKey = async () => {
    setIsGeneratingKey(true);
    try {
      const res = await fetch("/api/provider/api-keys", { method: "POST" });
      if (!res.ok) throw new Error("Generation failed");
      const { key, prefix } = await res.json();
      setApiKeyPrefix(prefix);
      setNewlyGeneratedKey(key);
      setCopiedKey(false);
    } catch {
      toast.error("Could not generate API key");
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const handleRevokeApiKey = async () => {
    try {
      const res = await fetch("/api/provider/api-keys", { method: "DELETE" });
      if (!res.ok) throw new Error("Revoke failed");
      setApiKeyPrefix(null);
      setNewlyGeneratedKey(null);
      toast.success("API key revoked");
    } catch {
      toast.error("Could not revoke API key");
    }
  };

  const handleCopyApiKey = () => {
    if (!newlyGeneratedKey) return;
    navigator.clipboard.writeText(newlyGeneratedKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleTestWebhook = async () => {
    if (!webhookUrl) {
      toast.error("Enter a webhook URL first");
      return;
    }
    try {
      const response = await fetch("/api/webhooks/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, secret: webhookSecret }),
      });
      if (!response.ok) throw new Error("Webhook test failed");
      toast.success("Test event sent to webhook");
    } catch {
      toast.error("Could not reach facilitator server");
    }
  };

  const toggleNotification = (id: string, type: "email" | "webhook") => {
    const updated = notifications.map((n) =>
      n.id === id ? { ...n, [type]: !n[type] } : n,
    );
    setNotifications(updated);
    // Persist to server — fire-and-forget, UI already updated optimistically
    fetch("/api/provider/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifications: updated }),
    }).catch(() => {});
  };

  const handleCopyAddress = (name: string, addr: string) => {
    if (!addr) return;
    navigator.clipboard.writeText(addr);
    setCopiedAddress(name);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const handleGmpTopUp = async () => {
    if (!gmpTopUpAmount || !isConnected) return;
    try {
      const hash = await sendTransactionAsync({
        to: contractAddresses.subscriptionRegistry as `0x${string}`,
        value: parseEther(gmpTopUpAmount),
      });
      toast.success(`Top-up submitted: ${hash.slice(0, 10)}…`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Top-up failed");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your provider configuration and protocol settings
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-6"
      >
        <TabsList className="bg-secondary border border-border p-1 flex-wrap h-auto gap-1">
          <TabsTrigger
            value="profile"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <User className="w-4 h-4 mr-2" />
            Provider
          </TabsTrigger>
          <TabsTrigger
            value="contracts"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Link2 className="w-4 h-4 mr-2" />
            Contracts
          </TabsTrigger>
          <TabsTrigger
            value="notifications"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Bell className="w-4 h-4 mr-2" />
            Notifications
          </TabsTrigger>
          <TabsTrigger
            value="apikeys"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Shield className="w-4 h-4 mr-2" />
            API Keys
          </TabsTrigger>
          <TabsTrigger
            value="gmp"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Fuel className="w-4 h-4 mr-2" />
            GMP Gas
          </TabsTrigger>
          <TabsTrigger
            value="danger"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <AlertTriangle className="w-4 h-4 mr-2" />
            Danger Zone
          </TabsTrigger>
        </TabsList>

        {/* Provider Profile Tab */}
        <TabsContent
          value="profile"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Provider Profile
              </CardTitle>
              <CardDescription>
                Your public-facing provider information stored in PlanFactory
                metadata
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="providerName">Provider Name</Label>
                  <Input
                    id="providerName"
                    placeholder="e.g. My SaaS Platform"
                    value={providerName}
                    onChange={(e) => setProviderName(e.target.value)}
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    placeholder="https://example.com"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Contact Email</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    placeholder="billing@example.com"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chainId">Network</Label>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {chainId === 11155111
                        ? "Sepolia Testnet"
                        : chainId === 8453
                          ? "Base Mainnet"
                          : chainId === 84532
                            ? "Base Sepolia"
                            : "Unknown"}{" "}
                      (Chain ID: {chainId})
                    </span>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Workspace Environment Mode
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Current mode:{" "}
                      <span className="font-mono text-foreground">
                        {environmentMode}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={
                        environmentMode === "DEVELOPMENT"
                          ? "default"
                          : "outline"
                      }
                      size="sm"
                      onClick={() => handleSwitchEnvironment("DEVELOPMENT")}
                    >
                      Development
                    </Button>
                    <Button
                      variant={
                        environmentMode === "PRODUCTION" ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => handleSwitchEnvironment("PRODUCTION")}
                    >
                      Production
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveProfile}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </TabsContent>

        {/* Contracts Tab */}
        <TabsContent
          value="contracts"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Deployed Contract Addresses
              </CardTitle>
              <CardDescription>
                Smart contracts deployed on{" "}
                {chainId === 11155111 ? "Sepolia" : `Chain ${chainId}`}.
                Read-only — connect wallet to interact.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {contractList.map((contract, index) => {
                  const addr = contractAddresses[contract.key] as
                    | string
                    | undefined;
                  const isZero =
                    !addr ||
                    addr === "0x0000000000000000000000000000000000000000";
                  return (
                    <div
                      key={contract.name}
                      className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border animate-in fade-in slide-in-from-left-2"
                      style={{
                        animationDelay: `${index * 50}ms`,
                        animationFillMode: "both",
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-medium text-foreground">
                            {contract.name}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {contract.description}
                        </p>
                        {!isZero ? (
                          <code className="text-xs text-chart-1 font-mono mt-1 block truncate">
                            {addr}
                          </code>
                        ) : (
                          <span className="text-xs text-muted-foreground/50 mt-1 block">
                            Not deployed on this chain
                          </span>
                        )}
                      </div>
                      {!isZero && addr && (
                        <div className="flex items-center gap-2 ml-4 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            onClick={() =>
                              handleCopyAddress(contract.name, addr)
                            }
                          >
                            {copiedAddress === contract.name ? (
                              <Check className="w-3.5 h-3.5 text-success" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            asChild
                          >
                            <a
                              href={getBlockExplorerUrl(
                                chainId,
                                "address",
                                addr,
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent
          value="notifications"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {/* Event Notification Toggles */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Event Notifications
              </CardTitle>
              <CardDescription>
                Configure how you receive billing and protocol event
                notifications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr,80px,80px] gap-4 pb-3 border-b border-border text-sm text-muted-foreground">
                  <span>Event Type</span>
                  <span className="text-center">Email</span>
                  <span className="text-center">Webhook</span>
                </div>
                {notifications.map((notification, index) => (
                  <div
                    key={notification.id}
                    className="grid grid-cols-[1fr,80px,80px] gap-4 py-4 border-b border-border last:border-0 animate-in fade-in slide-in-from-left-2"
                    style={{
                      animationDelay: `${index * 50}ms`,
                      animationFillMode: "both",
                    }}
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {notification.label}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {notification.description}
                      </p>
                    </div>
                    <div className="flex items-center justify-center">
                      <Switch
                        checked={notification.email}
                        onCheckedChange={() =>
                          toggleNotification(notification.id, "email")
                        }
                      />
                    </div>
                    <div className="flex items-center justify-center">
                      <Switch
                        checked={notification.webhook}
                        onCheckedChange={() =>
                          toggleNotification(notification.id, "webhook")
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Webhook Configuration */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Webhook Configuration
              </CardTitle>
              <CardDescription>
                Configure your webhook endpoint for real-time event delivery.
                Signed with HMAC-SHA256 (X-MEAP-Signature).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="webhookUrl">Webhook URL</Label>
                <Input
                  id="webhookUrl"
                  placeholder="https://api.example.com/webhook/arcenpay"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="bg-secondary border-border focus:border-accent font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="webhookSecret">Signing Secret</Label>
                <Input
                  id="webhookSecret"
                  type="password"
                  placeholder="whsec_..."
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  className="bg-secondary border-border focus:border-accent font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Used to sign payloads with HMAC-SHA256 via X-MEAP-Signature
                  header. Retry policy: exponential backoff up to 5 retries.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestWebhook}
                  disabled={!webhookUrl}
                >
                  Test Webhook
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveWebhookConfig}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Save Webhook Config
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Webhook Delivery Log */}
          <WebhookLogCard />
        </TabsContent>

        {/* API Keys Tab */}
        <TabsContent
          value="apikeys"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Provider API Key
              </CardTitle>
              <CardDescription>
                Use this key to authenticate server-to-server requests to the
                ArcenPay API. The full key is shown only once — store it
                securely.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 border border-border">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Current Key
                  </p>
                  {apiKeyPrefix ? (
                    <code className="text-xs text-chart-1 font-mono mt-1 block">
                      {apiKeyPrefix}••••••••••••••••••••••••••••••••••••••••
                    </code>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      No active key
                    </p>
                  )}
                </div>
                <Badge
                  variant="secondary"
                  className={
                    apiKeyPrefix
                      ? "bg-success/10 text-success border-success/20"
                      : "bg-muted/50 text-muted-foreground border-border"
                  }
                >
                  {apiKeyPrefix ? "Active" : "None"}
                </Badge>
              </div>

              {newlyGeneratedKey && (
                <div className="space-y-2 p-4 rounded-xl border border-warning/30 bg-warning/5">
                  <p className="text-xs font-medium text-warning flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Copy this key now — it will not be shown again
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono text-foreground bg-secondary px-3 py-2 rounded-lg border border-border break-all">
                      {newlyGeneratedKey}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={handleCopyApiKey}
                    >
                      {copiedKey ? (
                        <Check className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <Button
                  disabled={isGeneratingKey}
                  onClick={() => setGenerateKeySheetOpen(true)}
                >
                  {isGeneratingKey ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      {apiKeyPrefix ? "Regenerate Key" : "Generate Key"}
                    </>
                  )}
                </Button>
                <AlertDialog
                  open={generateKeySheetOpen}
                  onOpenChange={setGenerateKeySheetOpen}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {apiKeyPrefix
                          ? "Regenerate API Key?"
                          : "Generate API Key?"}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {apiKeyPrefix
                          ? "This will invalidate your existing key immediately. Any integrations using the old key will stop working."
                          : "A new API key will be generated. You will only see the full key once."}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void handleGenerateApiKey();
                          setGenerateKeySheetOpen(false);
                        }}
                        disabled={isGeneratingKey}
                      >
                        {apiKeyPrefix ? "Regenerate" : "Generate"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                {apiKeyPrefix && (
                  <>
                    <Button
                      variant="outline"
                      className="border-destructive/30 text-destructive hover:bg-destructive/10"
                      onClick={() => setRevokeKeySheetOpen(true)}
                    >
                      Revoke Key
                    </Button>
                    <AlertDialog
                      open={revokeKeySheetOpen}
                      onOpenChange={setRevokeKeySheetOpen}
                    >
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently invalidate the current API
                            key. Any integrations using it will immediately lose
                            access.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                              void handleRevokeApiKey();
                              setRevokeKeySheetOpen(false);
                            }}
                          >
                            Revoke
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Send the key as{" "}
                  <code className="text-foreground">
                    Authorization: Bearer ak_live_…
                  </code>{" "}
                  header. Only one active key per provider. Regenerating
                  invalidates the previous key immediately.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* GMP Gas Tab */}
        <TabsContent
          value="gmp"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/5 border border-accent/20">
            <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Axelar GMP Gas Balance
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cross-chain GMP messages (via Axelar) require native token
                pre-funding in the SubscriptionRegistry contract. A low balance
                pauses cross-chain entitlement sync.
              </p>
            </div>
          </div>

          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Fuel className="w-4 h-4" />
                Current GMP Gas Balance
              </CardTitle>
              <CardDescription>
                Native ETH held in SubscriptionRegistry for Axelar GMP fee
                payments
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 border border-border">
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {gmpBalance
                      ? `${parseFloat(gmpBalance.formatted).toFixed(4)} ETH`
                      : "0.000 ETH"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    ≈{" "}
                    {gmpBalance?.formatted
                      ? `$${(parseFloat(gmpBalance.formatted) * 3200).toFixed(2)}`
                      : "$0.00"}{" "}
                    USD · Sepolia
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className={
                    gmpBalance && parseFloat(gmpBalance.formatted) > 0.01
                      ? "bg-success/10 text-success border-success/20"
                      : "bg-warning/10 text-warning border-warning/20"
                  }
                >
                  {gmpBalance && parseFloat(gmpBalance.formatted) > 0.01
                    ? "Funded"
                    : "Not Funded"}
                </Badge>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Configured Transport Adapters
                </p>
                {[
                  {
                    label: "Axelar (Primary)",
                    addr: axelarTransportAddr,
                    configured: axelarConfigured,
                  },
                  {
                    label: "CCIP (Fallback)",
                    addr: ccipTransportAddr,
                    configured: ccipConfigured,
                  },
                ].map(({ label, addr, configured }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border text-sm"
                  >
                    <span className="text-foreground font-medium">{label}</span>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={
                          configured
                            ? "bg-success/10 text-success border-success/20"
                            : "bg-warning/10 text-warning border-warning/20"
                        }
                      >
                        {configured ? "Configured" : "Not Set"}
                      </Badge>
                      {configured && addr && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {addr.slice(0, 6)}…{addr.slice(-4)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-3 pt-2 border-t border-border">
                <p className="text-sm font-medium text-foreground">
                  Update Transport Adapters
                </p>
                <p className="text-xs text-muted-foreground">
                  Set the Axelar and CCIP adapter contract addresses. Requires
                  contract owner wallet. Leave blank to clear.
                </p>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Axelar Transport Address
                    </Label>
                    <Input
                      placeholder="0x… (leave blank to clear)"
                      value={newAxelarTransport}
                      onChange={(e) => setNewAxelarTransport(e.target.value)}
                      className="bg-secondary border-border focus:border-accent font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      CCIP Transport Address
                    </Label>
                    <Input
                      placeholder="0x… (leave blank to clear)"
                      value={newCcipTransport}
                      onChange={(e) => setNewCcipTransport(e.target.value)}
                      className="bg-secondary border-border focus:border-accent font-mono text-sm"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={handleSetTransports}
                    disabled={
                      !isConnected ||
                      isSettingTransports ||
                      !!setTransportsTxHash
                    }
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {isSettingTransports ? "Submitting…" : "Set Transports"}
                  </Button>
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-border">
                <p className="text-sm font-medium text-foreground">
                  Top Up Gas Balance
                </p>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="0.05"
                      value={gmpTopUpAmount}
                      onChange={(e) => setGmpTopUpAmount(e.target.value)}
                      className="bg-secondary border-border focus:border-accent pr-12"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      ETH
                    </span>
                  </div>
                  <Button
                    className="flex items-center gap-2 shrink-0"
                    onClick={handleGmpTopUp}
                    disabled={!isConnected || !gmpTopUpAmount}
                  >
                    <Plus className="w-4 h-4" />
                    Top Up
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sends native ETH to SubscriptionRegistry contract. Minimum
                  recommended: 0.05 ETH per active destination chain.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Danger Zone Tab */}
        <TabsContent
          value="danger"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <Card className="border-destructive/30 bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium text-destructive flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Danger Zone
              </CardTitle>
              <CardDescription>
                Irreversible actions that affect your protocol deployment
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  title: "Emergency Pause",
                  desc: "Pause all billing operations. Existing subscriptions remain active but no new charges will process.",
                  btnLabel: "Pause Protocol",
                  confirmTitle: "Pause Protocol?",
                  confirmDesc:
                    "This will halt all autopay billing. Subscribers will not be charged until you unpause. This action is on-chain and requires gas.",
                },
                {
                  title: "Update Fee Settings",
                  desc: "Modify the protocol fee structure. Requires on-chain transaction via FeeCollector.",
                  btnLabel: "Modify Fees",
                  confirmTitle: "Modify Fee Settings?",
                  confirmDesc:
                    "Changing fee rates affects all future billing events. This is an on-chain transaction.",
                },
                {
                  title: "Revoke All Autopay Modules",
                  desc: "Force-uninstall ERC7579AutopayModule from all subscriber smart accounts. Immediately terminates all future billing authority.",
                  btnLabel: "Revoke All",
                  confirmTitle: "Revoke All Autopay Modules?",
                  confirmDesc:
                    "This will permanently terminate autopay for ALL subscribers. They will need to re-enroll to re-enable autopay. This cannot be undone.",
                },
              ].map((action) => (
                <div
                  key={action.title}
                  className="flex items-center justify-between p-4 rounded-lg bg-destructive/5 border border-destructive/20"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {action.title}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {action.desc}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="border-destructive/30 text-destructive hover:bg-destructive/10 shrink-0"
                    disabled={!isConnected}
                    onClick={() =>
                      setPendingDangerAction({
                        confirmTitle: action.confirmTitle,
                        confirmDesc: action.confirmDesc,
                        confirmLabel: "Confirm",
                      })
                    }
                  >
                    {action.btnLabel}
                  </Button>
                </div>
              ))}
              <AlertDialog
                open={pendingDangerAction !== null}
                onOpenChange={(open) => {
                  if (!open) setPendingDangerAction(null);
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {pendingDangerAction?.confirmTitle}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {pendingDangerAction?.confirmDesc}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => {
                        toast.info("Action requires contract implementation");
                        setPendingDangerAction(null);
                      }}
                    >
                      {pendingDangerAction?.confirmLabel ?? "Confirm"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
