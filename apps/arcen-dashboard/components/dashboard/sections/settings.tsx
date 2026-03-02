"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";

const contractAddresses = [
  { name: "PlanFactory", address: "", description: "Creates and manages subscription plans" },
  { name: "SubscriptionRegistry", address: "", description: "NFT-based subscription management" },
  { name: "SessionVault", address: "", description: "Agent session fund storage" },
  { name: "FeeCollector", address: "", description: "Protocol fee collection" },
  { name: "ZKUsageVerifier", address: "", description: "zk-SNARK proof verification" },
  { name: "ERC7579AutopayModule", address: "", description: "Automated billing module" },
  { name: "MirrorRegistry", address: "", description: "Cross-chain entitlement sync" },
];

const notificationSettings = [
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

export function SettingsSection() {
  const [activeTab, setActiveTab] = useState("profile");
  const [notifications, setNotifications] = useState(notificationSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => setIsSaving(false), 1500);
  };

  const toggleNotification = (id: string, type: "email" | "webhook") => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, [type]: !n[type] } : n))
    );
  };

  const handleCopyAddress = (name: string, address: string) => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopiedAddress(name);
    setTimeout(() => setCopiedAddress(null), 2000);
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
        <TabsList className="bg-secondary border border-border p-1">
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
            value="danger"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Shield className="w-4 h-4 mr-2" />
            Danger Zone
          </TabsTrigger>
        </TabsList>

        {/* Provider Profile Tab */}
        <TabsContent value="profile" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Provider Profile</CardTitle>
              <CardDescription>Your public-facing provider information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="providerName">Provider Name</Label>
                  <Input
                    id="providerName"
                    placeholder="e.g. My SaaS Platform"
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    placeholder="https://example.com"
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Contact Email</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    placeholder="billing@example.com"
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chainId">Network</Label>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Sepolia Testnet (Chain ID: 11155111)
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
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
        <TabsContent value="contracts" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Deployed Contract Addresses</CardTitle>
              <CardDescription>
                Smart contracts deployed on the current network. These are read-only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {contractAddresses.map((contract, index) => (
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
                      {contract.address ? (
                        <code className="text-xs text-chart-1 font-mono mt-1 block truncate">
                          {contract.address}
                        </code>
                      ) : (
                        <span className="text-xs text-muted-foreground/50 mt-1 block">
                          Not configured
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      {contract.address && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            onClick={() => handleCopyAddress(contract.name, contract.address)}
                          >
                            {copiedAddress === contract.name ? (
                              <Check className="w-3.5 h-3.5 text-success" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">Event Notifications</CardTitle>
              <CardDescription>
                Configure how you receive billing and protocol event notifications
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
                Configure your webhook endpoint for real-time event delivery
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="webhookUrl">Webhook URL</Label>
                <Input
                  id="webhookUrl"
                  placeholder="https://api.example.com/webhook/arcenpay"
                  className="bg-secondary border-border focus:border-accent font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="webhookSecret">Signing Secret</Label>
                <Input
                  id="webhookSecret"
                  type="password"
                  placeholder="whsec_..."
                  className="bg-secondary border-border focus:border-accent font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Used to sign payloads with HMAC-SHA256 via X-MEAP-Signature header
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
                <AlertTriangle className="w-4 h-4" />
                Danger Zone
              </CardTitle>
              <CardDescription>
                Irreversible actions that affect your protocol deployment
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                <div>
                  <p className="font-medium text-foreground">Emergency Pause</p>
                  <p className="text-sm text-muted-foreground">
                    Pause all billing operations. Existing subscriptions remain active but no new charges will process.
                  </p>
                </div>
                <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10 shrink-0">
                  Pause Protocol
                </Button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                <div>
                  <p className="font-medium text-foreground">Update Fee Settings</p>
                  <p className="text-sm text-muted-foreground">
                    Modify the protocol fee structure. Requires on-chain transaction.
                  </p>
                </div>
                <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10 shrink-0">
                  Modify Fees
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
