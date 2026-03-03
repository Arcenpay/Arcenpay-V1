"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
    AlertDialogTrigger,
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
    Mail,
} from "lucide-react";
import { useAccount, useChainId, useBalance, useSendTransaction } from "wagmi";
import { parseEther } from "viem";
import { toast } from "sonner";
import { useContractAddresses } from "@/lib/contracts";
import { getBlockExplorerUrl } from "@/lib/format";

const NOTIFICATION_DEFAULTS = [
    { id: "new_subscriber", label: "New Subscriber", description: "When a new subscriber mints an NFT to your plan", email: false, webhook: false },
    { id: "renewal", label: "Subscription Renewal", description: "When a subscription is successfully renewed", email: false, webhook: false },
    { id: "cancellation", label: "Subscription Cancellation", description: "When a subscriber cancels their subscription", email: false, webhook: false },
    { id: "payment_failed", label: "Payment Failed", description: "When an autopay billing attempt fails", email: false, webhook: false },
    { id: "billing_settled", label: "Billing Settled", description: "When a zk proof is verified and usage is settled on-chain", email: false, webhook: false },
    { id: "low_balance", label: "Low Session Balance", description: "When an agent's session vault drops below 20%", email: false, webhook: false },
];

const GMP_DESTINATIONS = [
    { chain: "Base", estimatedGas: "0.0012 ETH" },
    { chain: "Polygon", estimatedGas: "0.0008 ETH" },
    { chain: "Arbitrum", estimatedGas: "0.0009 ETH" },
];

const LS_KEY = "meap_provider_settings";

function loadSettings() {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveSettings(data: Record<string, unknown>) {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_KEY, JSON.stringify(data));
}

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
                setEntries(data.entries || []);
            }
        } catch {
            // Silent — facilitator may not be running in dev
        } finally {
            setIsRefreshing(false);
        }
    };

    useEffect(() => { void fetchLog(); }, []);

    const statusColor = (status: string) => {
        if (status === "delivered") return "bg-success/10 text-success border-success/20";
        if (status === "failed") return "bg-destructive/10 text-destructive border-destructive/20";
        return "bg-warning/10 text-warning border-warning/20";
    };

    return (
        <Card className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle className="text-base font-medium">Webhook Delivery Log</CardTitle>
                    <CardDescription>Recent webhook delivery attempts with status and retry count</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={fetchLog} disabled={isRefreshing}>
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
                    Refresh
                </Button>
            </CardHeader>
            <CardContent>
                {entries.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                        {isRefreshing ? "Loading..." : "No webhook deliveries yet. Configure a webhook URL above and trigger a test event."}
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
                                <span className="text-foreground font-mono text-xs truncate">{entry.eventType}</span>
                                <Badge variant="secondary" className={`text-xs ${statusColor(entry.status)}`}>
                                    {entry.status}
                                </Badge>
                                <span className="text-muted-foreground text-xs">
                                    {new Date(entry.createdAt).toLocaleTimeString()}
                                </span>
                                <span className="text-right text-muted-foreground text-xs">{entry.retries}</span>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export function SettingsSection() {
    const { address, isConnected } = useAccount();
    const chainId = useChainId();
    const contractAddresses = useContractAddresses();

    const [activeTab, setActiveTab] = useState("profile");
    const [notifications, setNotifications] = useState(NOTIFICATION_DEFAULTS);
    const [isSaving, setIsSaving] = useState(false);
    const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

    // Profile
    const [providerName, setProviderName] = useState("");
    const [website, setWebsite] = useState("");
    const [contactEmail, setContactEmail] = useState("");

    // Email
    const [emailProvider, setEmailProvider] = useState<"resend" | "sendgrid">("resend");
    const [emailApiKey, setEmailApiKey] = useState("");
    const [fromEmail, setFromEmail] = useState("");
    const [emailApiKeyVisible, setEmailApiKeyVisible] = useState(false);

    // Webhook
    const [webhookUrl, setWebhookUrl] = useState("");
    const [webhookSecret, setWebhookSecret] = useState("");

    // GMP
    const [gmpTopUpAmount, setGmpTopUpAmount] = useState("");

    // Load from localStorage on mount
    useEffect(() => {
        const saved = loadSettings();
        if (!saved) return;
        if (saved.providerName) setProviderName(saved.providerName);
        if (saved.website) setWebsite(saved.website);
        if (saved.contactEmail) setContactEmail(saved.contactEmail);
        if (saved.emailProvider) setEmailProvider(saved.emailProvider);
        if (saved.emailApiKey) setEmailApiKey(saved.emailApiKey);
        if (saved.fromEmail) setFromEmail(saved.fromEmail);
        if (saved.webhookUrl) setWebhookUrl(saved.webhookUrl);
        if (saved.webhookSecret) setWebhookSecret(saved.webhookSecret);
        if (saved.notifications) setNotifications(saved.notifications);
    }, []);

    // Read SubscriptionRegistry ETH balance (for GMP gas)
    const { data: gmpBalance } = useBalance({
        address: contractAddresses.subscriptionRegistry as `0x${string}`,
        query: { enabled: isConnected },
    });

    const { sendTransactionAsync } = useSendTransaction();

    const contractList = [
        { name: "PlanFactory", key: "planFactory" as const, description: "Creates and manages subscription plans" },
        { name: "SubscriptionRegistry", key: "subscriptionRegistry" as const, description: "NFT-based subscription management" },
        { name: "SessionVault", key: "sessionVault" as const, description: "Agent session fund storage" },
        { name: "FeeCollector", key: "feeCollector" as const, description: "Protocol fee collection" },
        { name: "ZKUsageVerifier", key: "zkUsageVerifier" as const, description: "zk-SNARK proof verification" },
        { name: "ERC7579AutopayModule", key: "autopayModule" as const, description: "Automated billing module" },
        ...(contractAddresses.mirrorRegistry
            ? [{ name: "MirrorRegistry", key: "mirrorRegistry" as const, description: "Cross-chain entitlement sync" }]
            : []),
    ] as Array<{ name: string; key: keyof typeof contractAddresses; description: string }>;

    const handleSaveProfile = () => {
        setIsSaving(true);
        saveSettings({ providerName, website, contactEmail, emailProvider, emailApiKey, fromEmail, webhookUrl, webhookSecret, notifications });
        setTimeout(() => {
            setIsSaving(false);
            toast.success("Settings saved");
        }, 400);
    };

    const handleSaveEmailConfig = () => {
        setIsSaving(true);
        saveSettings({ providerName, website, contactEmail, emailProvider, emailApiKey, fromEmail, webhookUrl, webhookSecret, notifications });
        setTimeout(() => {
            setIsSaving(false);
            toast.success("Email config saved");
        }, 400);
    };

    const handleTestWebhook = async () => {
        if (!webhookUrl) {
            toast.error("Enter a webhook URL first");
            return;
        }
        try {
            const facilitatorUrl = process.env.NEXT_PUBLIC_FACILITATOR_URL || "http://localhost:3402";
            await fetch(`${facilitatorUrl}/api/webhooks/test`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: webhookUrl, secret: webhookSecret }),
            });
            toast.success("Test event sent to webhook");
        } catch {
            toast.error("Could not reach facilitator server");
        }
    };

    const toggleNotification = (id: string, type: "email" | "webhook") => {
        const updated = notifications.map((n) =>
            n.id === id ? { ...n, [type]: !n[type] } : n
        );
        setNotifications(updated);
        saveSettings({ providerName, website, contactEmail, emailProvider, emailApiKey, fromEmail, webhookUrl, webhookSecret, notifications: updated });
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

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <TabsList className="bg-secondary border border-border p-1 flex-wrap h-auto gap-1">
                    <TabsTrigger value="profile" className="data-[state=active]:bg-card data-[state=active]:text-foreground">
                        <User className="w-4 h-4 mr-2" />Provider
                    </TabsTrigger>
                    <TabsTrigger value="contracts" className="data-[state=active]:bg-card data-[state=active]:text-foreground">
                        <Link2 className="w-4 h-4 mr-2" />Contracts
                    </TabsTrigger>
                    <TabsTrigger value="notifications" className="data-[state=active]:bg-card data-[state=active]:text-foreground">
                        <Bell className="w-4 h-4 mr-2" />Notifications
                    </TabsTrigger>
                    <TabsTrigger value="gmp" className="data-[state=active]:bg-card data-[state=active]:text-foreground">
                        <Fuel className="w-4 h-4 mr-2" />GMP Gas
                    </TabsTrigger>
                    <TabsTrigger value="danger" className="data-[state=active]:bg-card data-[state=active]:text-foreground">
                        <Shield className="w-4 h-4 mr-2" />Danger Zone
                    </TabsTrigger>
                </TabsList>

                {/* Provider Profile Tab */}
                <TabsContent value="profile" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <Card className="border-border bg-card">
                        <CardHeader>
                            <CardTitle className="text-base font-medium">Provider Profile</CardTitle>
                            <CardDescription>Your public-facing provider information stored in PlanFactory metadata</CardDescription>
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
                        </CardContent>
                    </Card>

                    <div className="flex justify-end">
                        <Button
                            onClick={handleSaveProfile}
                            className="bg-accent hover:bg-accent/90 text-accent-foreground"
                            disabled={isSaving}
                        >
                            {isSaving ? (
                                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                            ) : (
                                <><Check className="w-4 h-4 mr-2" />Save Changes</>
                            )}
                        </Button>
                    </div>
                </TabsContent>

                {/* Contracts Tab */}
                <TabsContent value="contracts" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <Card className="border-border bg-card">
                        <CardHeader>
                            <CardTitle className="text-base font-medium">Deployed Contract Addresses</CardTitle>
                            <CardDescription>
                                Smart contracts deployed on {chainId === 11155111 ? "Sepolia" : `Chain ${chainId}`}. Read-only — connect wallet to interact.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {contractList.map((contract, index) => {
                                    const addr = contractAddresses[contract.key] as string | undefined;
                                    const isZero = !addr || addr === "0x0000000000000000000000000000000000000000";
                                    return (
                                        <div
                                            key={contract.name}
                                            className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border animate-in fade-in slide-in-from-left-2"
                                            style={{ animationDelay: `${index * 50}ms`, animationFillMode: "both" }}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <p className="text-sm font-medium text-foreground">{contract.name}</p>
                                                </div>
                                                <p className="text-xs text-muted-foreground">{contract.description}</p>
                                                {!isZero ? (
                                                    <code className="text-xs text-chart-1 font-mono mt-1 block truncate">{addr}</code>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground/50 mt-1 block">Not deployed on this chain</span>
                                                )}
                                            </div>
                                            {!isZero && addr && (
                                                <div className="flex items-center gap-2 ml-4 shrink-0">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8"
                                                        onClick={() => handleCopyAddress(contract.name, addr)}
                                                    >
                                                        {copiedAddress === contract.name ? (
                                                            <Check className="w-3.5 h-3.5 text-success" />
                                                        ) : (
                                                            <Copy className="w-3.5 h-3.5" />
                                                        )}
                                                    </Button>
                                                    <Button variant="ghost" size="sm" className="h-8" asChild>
                                                        <a
                                                            href={getBlockExplorerUrl(chainId, "address", addr)}
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
                <TabsContent value="notifications" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {/* Email Provider */}
                    <Card className="border-border bg-card">
                        <CardHeader>
                            <CardTitle className="text-base font-medium flex items-center gap-2">
                                <Mail className="w-4 h-4" />Email Provider
                            </CardTitle>
                            <CardDescription>
                                Configure your transactional email provider. API key is stored in localStorage.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-2">
                                {(["resend", "sendgrid"] as const).map((p) => (
                                    <button
                                        key={p}
                                        onClick={() => setEmailProvider(p)}
                                        className={`px-4 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 ${emailProvider === p
                                            ? "bg-accent text-accent-foreground border-accent"
                                            : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                                            }`}
                                    >
                                        {p === "resend" ? "Resend" : "SendGrid"}
                                    </button>
                                ))}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="emailApiKey">{emailProvider === "resend" ? "Resend" : "SendGrid"} API Key</Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="emailApiKey"
                                        type={emailApiKeyVisible ? "text" : "password"}
                                        placeholder={emailProvider === "resend" ? "re_..." : "SG..."}
                                        value={emailApiKey}
                                        onChange={(e) => setEmailApiKey(e.target.value)}
                                        className="bg-secondary border-border focus:border-accent font-mono text-sm flex-1"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="shrink-0"
                                        onClick={() => setEmailApiKeyVisible((v) => !v)}
                                    >
                                        {emailApiKeyVisible ? "Hide" : "Show"}
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="fromEmail">From Email Address</Label>
                                <Input
                                    id="fromEmail"
                                    type="email"
                                    placeholder="billing@example.com"
                                    value={fromEmail}
                                    onChange={(e) => setFromEmail(e.target.value)}
                                    className="bg-secondary border-border focus:border-accent"
                                />
                            </div>

                            <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
                                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                                <p className="text-xs text-muted-foreground">
                                    Templates: <span className="text-foreground">Welcome, Renewal Receipt, Payment Failed, Subscription Expiring (3d), Access Revoked, Low Session Balance</span>.
                                </p>
                            </div>

                            <div className="flex justify-end">
                                <Button className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={handleSaveEmailConfig} disabled={isSaving}>
                                    {isSaving ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving…</> : <><Check className="w-4 h-4 mr-2" />Save Email Config</>}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Event Notification Toggles */}
                    <Card className="border-border bg-card">
                        <CardHeader>
                            <CardTitle className="text-base font-medium">Event Notifications</CardTitle>
                            <CardDescription>Configure how you receive billing and protocol event notifications</CardDescription>
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
                                        style={{ animationDelay: `${index * 50}ms`, animationFillMode: "both" }}
                                    >
                                        <div>
                                            <p className="font-medium text-foreground">{notification.label}</p>
                                            <p className="text-sm text-muted-foreground">{notification.description}</p>
                                        </div>
                                        <div className="flex items-center justify-center">
                                            <Switch
                                                checked={notification.email}
                                                onCheckedChange={() => toggleNotification(notification.id, "email")}
                                            />
                                        </div>
                                        <div className="flex items-center justify-center">
                                            <Switch
                                                checked={notification.webhook}
                                                onCheckedChange={() => toggleNotification(notification.id, "webhook")}
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
                            <CardTitle className="text-base font-medium">Webhook Configuration</CardTitle>
                            <CardDescription>
                                Configure your webhook endpoint for real-time event delivery. Signed with HMAC-SHA256 (X-MEAP-Signature).
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
                                    Used to sign payloads with HMAC-SHA256 via X-MEAP-Signature header. Retry policy: exponential backoff up to 5 retries.
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
                                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                                    size="sm"
                                    onClick={handleSaveEmailConfig}
                                >
                                    Save Webhook Config
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Webhook Delivery Log */}
                    <WebhookLogCard />
                </TabsContent>


                {/* GMP Gas Tab */}
                <TabsContent value="gmp" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/5 border border-accent/20">
                        <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-foreground">Axelar GMP Gas Balance</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Cross-chain GMP messages (via Axelar) require native token pre-funding in the SubscriptionRegistry contract. A low balance pauses cross-chain entitlement sync.
                            </p>
                        </div>
                    </div>

                    <Card className="border-border bg-card">
                        <CardHeader>
                            <CardTitle className="text-base font-medium flex items-center gap-2">
                                <Fuel className="w-4 h-4" />Current GMP Gas Balance
                            </CardTitle>
                            <CardDescription>
                                Native ETH held in SubscriptionRegistry for Axelar GMP fee payments
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
                                        ≈ {gmpBalance?.formatted ? `$${(parseFloat(gmpBalance.formatted) * 3200).toFixed(2)}` : "$0.00"} USD · Sepolia
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
                                    {gmpBalance && parseFloat(gmpBalance.formatted) > 0.01 ? "Funded" : "Not Funded"}
                                </Badge>
                            </div>

                            <div className="space-y-2">
                                <p className="text-sm font-medium text-foreground">Per-Chain Cost Estimates</p>
                                {GMP_DESTINATIONS.map((dest) => (
                                    <div
                                        key={dest.chain}
                                        className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border text-sm"
                                    >
                                        <span className="text-foreground font-medium">{dest.chain}</span>
                                        <div className="flex items-center gap-4 text-right">
                                            <div>
                                                <p className="text-xs text-muted-foreground">Est. per message</p>
                                                <p className="font-medium text-foreground">{dest.estimatedGas}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-3 pt-2 border-t border-border">
                                <p className="text-sm font-medium text-foreground">Top Up Gas Balance</p>
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
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">ETH</span>
                                    </div>
                                    <Button
                                        className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 shrink-0"
                                        onClick={handleGmpTopUp}
                                        disabled={!isConnected || !gmpTopUpAmount}
                                    >
                                        <Plus className="w-4 h-4" />
                                        Top Up
                                    </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Sends native ETH to SubscriptionRegistry contract. Minimum recommended: 0.05 ETH per active destination chain.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Danger Zone Tab */}
                <TabsContent value="danger" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <Card className="border-destructive/30 bg-card">
                        <CardHeader>
                            <CardTitle className="text-base font-medium text-destructive flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />Danger Zone
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
                                    confirmDesc: "This will halt all autopay billing. Subscribers will not be charged until you unpause. This action is on-chain and requires gas.",
                                },
                                {
                                    title: "Update Fee Settings",
                                    desc: "Modify the protocol fee structure. Requires on-chain transaction via FeeCollector.",
                                    btnLabel: "Modify Fees",
                                    confirmTitle: "Modify Fee Settings?",
                                    confirmDesc: "Changing fee rates affects all future billing events. This is an on-chain transaction.",
                                },
                                {
                                    title: "Revoke All Autopay Modules",
                                    desc: "Force-uninstall ERC7579AutopayModule from all subscriber smart accounts. Immediately terminates all future billing authority.",
                                    btnLabel: "Revoke All",
                                    confirmTitle: "Revoke All Autopay Modules?",
                                    confirmDesc: "This will permanently terminate autopay for ALL subscribers. They will need to re-enroll to re-enable autopay. This cannot be undone.",
                                },
                            ].map((action) => (
                                <div key={action.title} className="flex items-center justify-between p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                                    <div>
                                        <p className="font-medium text-foreground">{action.title}</p>
                                        <p className="text-sm text-muted-foreground">{action.desc}</p>
                                    </div>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="outline"
                                                className="border-destructive/30 text-destructive hover:bg-destructive/10 shrink-0"
                                                disabled={!isConnected}
                                            >
                                                {action.btnLabel}
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>{action.confirmTitle}</AlertDialogTitle>
                                                <AlertDialogDescription>{action.confirmDesc}</AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                    onClick={() => toast.info("Action requires contract implementation")}
                                                >
                                                    Confirm
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
