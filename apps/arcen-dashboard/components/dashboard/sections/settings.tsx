"use client";
import { apiFetch } from "@/lib/api-client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
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
  Key,
  Loader2,
  Settings2,
  Wallet,
  Building2,
  Users,
  UserPlus,
  Trash2,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { ProtocolKeysPanel } from "@/components/dashboard/sections/api-keys";
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
import { getUsdcAddress, useContractAddresses } from "@/lib/contracts";
import { getBlockExplorerUrl } from "@/lib/format";
import { CANONICAL_WEBHOOK_EVENTS } from "@/lib/webhook-events";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { useStellarWallet } from "@/hooks/use-stellar-wallet";
import { useSolanaWallet } from "@/hooks/use-solana-wallet";
import {
  DEFAULT_CHAIN_ID,
  getChainLabel,
  resolveEnvironmentChainId,
} from "@/lib/default-chain";
import { SUPPORTED_WALLET_CHAIN_LABEL } from "@/hooks/use-dashboard-wallet";
import { useUnifiedDashboardWallet } from "@/hooks/use-unified-dashboard-wallet";
import { useEnvironment } from "@/contexts/environment-context";
import { isStellarChainId, isSolanaChainId } from "@arcenpay/internal-core";
import { isPlatformAdminEmail } from "@/lib/admin";

const NOTIFICATION_DEFAULTS = CANONICAL_WEBHOOK_EVENTS.map((event) => ({
  ...event,
  email: false,
  webhook: false,
}));

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

// ── Main SettingsSection ──────────────────────────────────────────────────────

export function SettingsSection() {
  const searchParams = useSearchParams();
  const {
    envMode,
    activeEnvironment,
    environments,
    environmentCounts,
    environmentLimits,
    selectEnvironment,
    refreshEnvironments,
  } = useEnvironment();
  // EVM-only wagmi state, used solely for EVM-specific reads below. All
  // user-facing wallet display goes through the family-aware facade.
  const { isConnected } = useAccount();
  const { data: sessionData } = useDashboardSession();
  const isPlatformAdmin =
    sessionData?.user?.isPlatformAdmin === true ||
    isPlatformAdminEmail(sessionData?.user?.email);
  const chainId = useChainId();
  const configuredChainId = activeEnvironment?.chainId ?? resolveEnvironmentChainId(envMode);
  const stellar = useStellarWallet(configuredChainId);
  const solanaWallet = useSolanaWallet(configuredChainId);
  const isStellarEnv = isStellarChainId(configuredChainId);
  const isSolanaEnv = isSolanaChainId(configuredChainId);
  const isNonEvmEnv = isStellarEnv || isSolanaEnv;

  const linkedWallet = isStellarEnv
    ? (sessionData?.user.stellarWalletAddress ?? undefined)
    : isSolanaEnv
      ? (sessionData?.user.solanaWalletAddress ?? undefined)
      : (sessionData?.user.walletAddress ?? undefined);

  // Family-aware wallet facade: for a Solana/Stellar environment the
  // "connected wallet" is the Solana/Stellar wallet, NOT the (possibly
  // unrelated) EVM wallet that wagmi happens to see.
  const {
    connectedAddress,
    connectedWalletLabel,
    disconnectWallet,
    hasConnectedWallet,
    hasLinkedWallet,
    isDisconnecting,
    isLinkedWalletConnected,
    isOnConfiguredNetwork,
    isSwitchingChain,
    isWrongWalletConnected,
    linkedWalletLabel,
    openAccountModal,
    openConnectModal,
    reconnectWallet,
    switchToRequiredNetwork,
    currentNetworkLabel,
  } = useUnifiedDashboardWallet(
    configuredChainId,
    sessionData?.user.walletAddress ?? null,
    sessionData?.user.stellarWalletAddress ?? null,
    sessionData?.user.solanaWalletAddress ?? null,
  );

  const displayLinkedWallet = linkedWallet ?? "No wallet linked yet";
  const displayConnectedWallet = isStellarEnv
    ? (stellar.address ? `${stellar.address.slice(0, 6)}…${stellar.address.slice(-4)}` : "Not connected")
    : isSolanaEnv
      ? (solanaWallet.address ? `${solanaWallet.address.slice(0, 6)}…${solanaWallet.address.slice(-4)}` : "Not connected")
      : (connectedWalletLabel ?? "Not connected");
  const displayNetworkLabel = isStellarEnv
    ? getChainLabel(configuredChainId)
    : isSolanaEnv
      ? getChainLabel(configuredChainId)
      : (currentNetworkLabel ?? "Not connected");
  const contractAddresses = useContractAddresses(configuredChainId);
  const configuredChainLabel = getChainLabel(configuredChainId);
  const activeUsdcAddress = getUsdcAddress(configuredChainId);
  const activePlanFactoryAddress =
    typeof contractAddresses.planFactory === "string"
      ? contractAddresses.planFactory
      : null;
  const activeSubscriptionRegistryAddress =
    typeof contractAddresses.subscriptionRegistry === "string"
      ? contractAddresses.subscriptionRegistry
      : null;

  const [activeTab, setActiveTab] = useState("profile");
  const [notifications, setNotifications] = useState(NOTIFICATION_DEFAULTS);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [teamInfo, setTeamInfo] = useState<{
    id: string;
    name: string;
    slug: string;
    environmentMode: "DEVELOPMENT" | "PRODUCTION";
    myRole: string;
    members: Array<{
      id: string;
      userId: string;
      role: string;
      email: string | null;
      walletAddress: string | null;
      joinedAt: string;
    }>;
  } | null>(null);
  const [pendingInvites, setPendingInvites] = useState<
    Array<{
      id: string;
      emailAddress: string;
      role: string;
      createdAt: string;
      expiresAt: string;
    }>
  >([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [deletingEnvironmentId, setDeletingEnvironmentId] = useState<string | null>(null);
  const [renamingEnvironmentId, setRenamingEnvironmentId] = useState<string | null>(null);
  const [environmentNameDraft, setEnvironmentNameDraft] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<
    "ADMIN" | "MEMBER" | "FINANCE" | "DEVELOPER" | "SUPPORT"
  >("MEMBER");

  // Profile
  const [providerName, setProviderName] = useState("");
  const [website, setWebsite] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [legalName, setLegalName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [supportUrl, setSupportUrl] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateProvince, setStateProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [taxId, setTaxId] = useState("");
  const [gstin, setGstin] = useState("");

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

  const environmentMode = activeEnvironment?.mode ?? envMode;

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
    const requestedTab = searchParams.get("tab");
    if (requestedTab) {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);

  const loadWorkspaceData = useCallback(async () => {
    try {
      setWorkspaceLoading(true);
      const [teamRes, invitesRes] = await Promise.all([
        apiFetch("/api/team", { cache: "no-store" }),
        apiFetch("/api/team/invites", { cache: "no-store" }),
      ]);

      const teamPayload = teamRes.ok ? await teamRes.json() : null;
      const invitesPayload = invitesRes.ok ? await invitesRes.json() : null;

      setTeamInfo(teamPayload);
      setPendingInvites(
        Array.isArray(invitesPayload?.invitations)
          ? invitesPayload.invitations
          : [],
      );
    } catch {
      setTeamInfo(null);
      setPendingInvites([]);
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  useEffect(() => {
    // Load all profile fields from the server — localStorage is no longer used
    apiFetch("/api/provider/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        if (!profile) return;
        if (profile.providerName) setProviderName(profile.providerName);
        if (profile.website) setWebsite(profile.website);
        if (profile.contactEmail) setContactEmail(profile.contactEmail);
        if (profile.legalName) setLegalName(profile.legalName);
        if (profile.billingEmail) setBillingEmail(profile.billingEmail);
        if (profile.supportEmail) setSupportEmail(profile.supportEmail);
        if (profile.supportPhone) setSupportPhone(profile.supportPhone);
        if (profile.supportUrl) setSupportUrl(profile.supportUrl);
        if (profile.addressLine1) setAddressLine1(profile.addressLine1);
        if (profile.addressLine2) setAddressLine2(profile.addressLine2);
        if (profile.city) setCity(profile.city);
        if (profile.state) setStateProvince(profile.state);
        if (profile.postalCode) setPostalCode(profile.postalCode);
        if (profile.country) setCountry(profile.country);
        if (profile.taxId) setTaxId(profile.taxId);
        if (profile.gstin) setGstin(profile.gstin);
      })
      .catch(() => {
        toast.error("Failed to load profile");
      });
    // Load notification preferences from server (source of truth — not localStorage)
    apiFetch("/api/provider/notifications")
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
      .catch(() => {
        toast.error("Failed to load notification preferences");
      });
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
      const res = await apiFetch("/api/provider/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerName: providerName || undefined,
          website: website || undefined,
          contactEmail: contactEmail || undefined,
          legalName: legalName || undefined,
          billingEmail: billingEmail || undefined,
          supportEmail: supportEmail || undefined,
          supportPhone: supportPhone || undefined,
          supportUrl: supportUrl || undefined,
          addressLine1: addressLine1 || undefined,
          addressLine2: addressLine2 || undefined,
          city: city || undefined,
          state: stateProvince || undefined,
          postalCode: postalCode || undefined,
          country: country || undefined,
          taxId: taxId || undefined,
          gstin: gstin || undefined,
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

  const toggleNotification = async (id: string, type: "email") => {
    const previous = notifications;
    const updated = notifications.map((n) =>
      n.id === id ? { ...n, [type]: !n[type] } : n,
    );
    setNotifications(updated);
    try {
      const response = await apiFetch("/api/provider/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifications: updated }),
      });
      if (!response.ok) {
        throw new Error("Could not save notification preferences");
      }
    } catch {
      setNotifications(previous);
      toast.error("Could not save notification preferences");
    }
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

  const canManageWorkspace =
    teamInfo?.myRole === "OWNER" || teamInfo?.myRole === "ADMIN";

  const handleSelectEnvironment = async (environmentId: string) => {
    setWorkspaceBusy(true);
    try {
      const ok = await selectEnvironment(environmentId);
      if (!ok) {
        throw new Error("Failed to switch environment");
      }
      await Promise.all([loadWorkspaceData(), refreshEnvironments()]);
      toast.success("Environment switched");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to switch environment",
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleRenameEnvironment = async (environmentId: string) => {
    if (!environmentNameDraft.trim()) {
      toast.error("Enter an environment name");
      return;
    }

    setWorkspaceBusy(true);
    try {
      const response = await apiFetch("/api/environments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environmentId,
          name: environmentNameDraft.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to rename environment");
      }
      setRenamingEnvironmentId(null);
      setEnvironmentNameDraft("");
      await Promise.all([loadWorkspaceData(), refreshEnvironments()]);
      toast.success("Environment renamed");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to rename environment",
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleDeleteEnvironment = async (environmentId: string, name: string) => {
    if (!window.confirm(`Delete the ${name} environment? This is allowed only when it has no active plans or subscriptions.`)) {
      return;
    }

    setDeletingEnvironmentId(environmentId);
    try {
      const response = await apiFetch("/api/environments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to delete environment");
      }
      await Promise.all([loadWorkspaceData(), refreshEnvironments()]);
      toast.success("Environment deleted");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete environment",
      );
    } finally {
      setDeletingEnvironmentId(null);
    }
  };

  const handleInviteMember = async () => {
    if (!inviteEmail.trim()) {
      toast.error("Enter an email address to invite");
      return;
    }

    setWorkspaceBusy(true);
    try {
      const response = await apiFetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to send invitation");
      }
      toast.success(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      setInviteRole("MEMBER");
      await loadWorkspaceData();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send invitation",
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleRevokeInvite = async (invitationId: string, email: string) => {
    setWorkspaceBusy(true);
    try {
      const response = await apiFetch(`/api/team/invites?id=${invitationId}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to revoke invitation");
      }
      toast.success(`Revoked invite for ${email}`);
      await loadWorkspaceData();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to revoke invitation",
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleRemoveMember = async (userId: string, label: string) => {
    setWorkspaceBusy(true);
    try {
      const response = await apiFetch(`/api/team/members?userId=${userId}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to remove member");
      }
      toast.success(`Removed ${label} from workspace`);
      await loadWorkspaceData();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove member",
      );
    } finally {
      setWorkspaceBusy(false);
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
            value="wallet"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Wallet className="w-4 h-4 mr-2" />
            Wallet
          </TabsTrigger>
          <TabsTrigger
            value="workspace"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Building2 className="w-4 h-4 mr-2" />
            Workspace
          </TabsTrigger>
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
            value="protocolkeys"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground"
          >
            <Key className="w-4 h-4 mr-2" />
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

        <TabsContent
          value="wallet"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <Card className="border-accent/30 bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Wallet className="w-4 h-4 text-accent" />
                Workspace Wallet
              </CardTitle>
              <CardDescription>
                Dashboard wallet actions support {SUPPORTED_WALLET_CHAIN_LABEL}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border bg-secondary/40 p-4">
                <p className="text-xs text-muted-foreground mb-1">Linked workspace wallet</p>
                <p className="font-mono text-sm text-foreground break-all">
                  {displayLinkedWallet}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-secondary/40 p-4">
                <p className="text-xs text-muted-foreground mb-1">Connected wallet</p>
                <p className="font-mono text-sm text-foreground">
                  {displayConnectedWallet}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Network: {displayNetworkLabel}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-secondary/40 p-4">
                <p className="text-xs text-muted-foreground mb-1">Supported networks</p>
                <p className="text-sm font-medium text-foreground">
                  {SUPPORTED_WALLET_CHAIN_LABEL}
                </p>
              </div>

              {!isStellarEnv && linkedWallet && isLinkedWalletConnected ? (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary p-3 text-sm text-foreground">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  Connected wallet matches the workspace wallet.
                </div>
              ) : null}

              {!isStellarEnv && linkedWallet && isWrongWalletConnected ? (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary p-3 text-sm text-warning">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  Connected wallet does not match {linkedWalletLabel}. Reconnect with the linked wallet before signing transactions.
                </div>
              ) : null}

              {!isStellarEnv && hasConnectedWallet && !isOnConfiguredNetwork ? (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary p-3 text-sm text-warning">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  This wallet is on an unsupported network. Switch to {configuredChainLabel} to match the current workspace environment.
                </div>
              ) : null}

              {isStellarEnv && stellar.isConnected ? (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary p-3 text-sm text-foreground">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  Stellar wallet connected on {configuredChainLabel}.
                </div>
              ) : null}

              {isSolanaEnv && solanaWallet.isConnected ? (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary p-3 text-sm text-foreground">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  Solana wallet connected on {configuredChainLabel}.
                </div>
              ) : null}

              <div className="grid gap-2 md:grid-cols-2">
                {isStellarEnv ? (
                  !stellar.isConnected ? (
                    <Button onClick={() => void stellar.connect()}>
                      <Wallet className="w-4 h-4 mr-2" />
                      Connect Stellar wallet
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => void stellar.disconnect()}>
                      <Wallet className="w-4 h-4 mr-2" />
                      Disconnect Stellar wallet
                    </Button>
                  )
                ) : isSolanaEnv ? (
                  !solanaWallet.isConnected ? (
                    <Button onClick={() => void solanaWallet.connect()}>
                      <Wallet className="w-4 h-4 mr-2" />
                      Connect Solana wallet
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => void solanaWallet.disconnect()}>
                      <Wallet className="w-4 h-4 mr-2" />
                      Disconnect Solana wallet
                    </Button>
                  )
                ) : (
                  <>
                    {!hasConnectedWallet ? (
                      <Button onClick={() => void openConnectModal()}>
                        <Wallet className="w-4 h-4 mr-2" />
                        Connect wallet
                      </Button>
                    ) : null}

                    {hasConnectedWallet ? (
                      <Button variant="outline" onClick={() => void openAccountModal()}>
                        <Settings2 className="w-4 h-4 mr-2" />
                        Open wallet modal
                      </Button>
                    ) : null}

                    {isWrongWalletConnected ? (
                      <Button variant="outline" onClick={() => void reconnectWallet()}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Reconnect correct wallet
                      </Button>
                    ) : null}

                    {hasConnectedWallet && !isOnConfiguredNetwork ? (
                      <Button
                        variant="outline"
                        onClick={() => void switchToRequiredNetwork(configuredChainId)}
                        disabled={isSwitchingChain}
                      >
                        {isSwitchingChain ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Switching network...
                          </>
                        ) : (
                          <>
                            <Globe className="w-4 h-4 mr-2" />
                            Switch to {configuredChainLabel}
                          </>
                        )}
                      </Button>
                    ) : null}

                    {hasConnectedWallet ? (
                      <Button
                        variant="ghost"
                        onClick={() => void disconnectWallet()}
                        disabled={isDisconnecting}
                      >
                        {isDisconnecting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Disconnecting...
                          </>
                        ) : (
                          <>
                            <Wallet className="w-4 h-4 mr-2" />
                            Disconnect wallet
                          </>
                        )}
                      </Button>
                    ) : null}
                  </>
                )}

                {!linkedWallet ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      window.location.href = "/login";
                    }}
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    Link workspace wallet
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="workspace"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Building2 className="w-4 h-4 text-accent" />
                Workspace Management
              </CardTitle>
              <CardDescription>
                Manage members, invitations, and the currently active workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {workspaceLoading ? (
                <div className="text-sm text-muted-foreground">Loading workspace details…</div>
              ) : teamInfo ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-border bg-secondary/40 p-4">
                      <p className="text-xs text-muted-foreground mb-1">Workspace</p>
                      <p className="text-sm font-semibold text-foreground">{teamInfo.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">/{teamInfo.slug}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-secondary/40 p-4">
                      <p className="text-xs text-muted-foreground mb-1">Your role</p>
                      <p className="text-sm font-semibold text-foreground">{teamInfo.myRole}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Current environment: {activeEnvironment?.name ?? "None selected"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-secondary/40 p-4">
                      <p className="text-xs text-muted-foreground mb-1">Other workspaces</p>
                      <p className="text-sm font-semibold text-foreground">
                        {sessionData?.teams.length ?? 0} total membership
                        {(sessionData?.teams.length ?? 0) === 1 ? "" : "s"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Switch instantly from the workspace menu in the header.
                      </p>
                    </div>
                  </div>

                  {/* Platform License Status */}
                  <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Platform License</p>
                          <p className="text-xs text-muted-foreground">
                            Tenant activation status and platform entitlement mode.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {sessionData?.currentTeam?.isPlatformActivated ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                            Activated
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/20">
                            Unactivated
                          </Badge>
                        )}
                        <Badge variant="secondary" className="font-mono text-xs">
                          {sessionData?.currentTeam?.platformTier ?? "FREE"}
                        </Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground pt-1">
                      <div>
                        <span className="font-medium text-foreground">Self-Service Billing: </span>
                        {sessionData?.currentTeam?.allowPlatformBilling ? "Enabled" : "Managed / Locked"}
                      </div>
                      {isPlatformAdmin ? (
                        <div className="text-left sm:text-right">
                          <a
                            href="/admin"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            Platform Admin Console <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Environments</p>
                        <p className="text-xs text-muted-foreground">
                          Every environment is locked to one chain and one mode.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.location.assign("/environments/new")}
                      >
                        <Plus className="w-3.5 h-3.5 mr-2" />
                        Create
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-border bg-background/60 p-3">
                        <p className="text-xs text-muted-foreground">Development</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {environmentCounts?.development ?? 0}
                          {" / "}
                          {environmentLimits?.development ?? "—"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border bg-background/60 p-3">
                        <p className="text-xs text-muted-foreground">Production</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {environmentCounts?.production ?? 0}
                          {" / "}
                          {environmentLimits?.production ?? "—"}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {environments.map((environment) => {
                        const isRenaming = renamingEnvironmentId === environment.id;
                        const isDefaultEnvironment = environments[0]?.id === environment.id;
                        return (
                          <div
                            key={environment.id}
                            className="rounded-xl border border-border bg-background/60 p-4"
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold text-foreground">
                                    {environment.name}
                                  </p>
                                  <Badge variant="outline">
                                    {environment.mode === "DEVELOPMENT" ? "DEV" : "PROD"}
                                  </Badge>
                                  {environment.isActive ? (
                                    <Badge variant="secondary">Active</Badge>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {environment.chainLabel} · Chain {environment.chainId}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {!environment.isActive ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={workspaceBusy}
                                    onClick={() => void handleSelectEnvironment(environment.id)}
                                  >
                                    Select
                                  </Button>
                                ) : null}
                                {canManageWorkspace ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={workspaceBusy}
                                    onClick={() => {
                                      setRenamingEnvironmentId(environment.id);
                                      setEnvironmentNameDraft(environment.name);
                                    }}
                                  >
                                    Rename
                                  </Button>
                                ) : null}
                                {canManageWorkspace && !isDefaultEnvironment ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    disabled={workspaceBusy || deletingEnvironmentId === environment.id}
                                    onClick={() => void handleDeleteEnvironment(environment.id, environment.name)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                                    {deletingEnvironmentId === environment.id ? "Deleting…" : "Delete"}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            {isRenaming ? (
                              <div className="mt-3 flex flex-col gap-2 md:flex-row">
                                <Input
                                  value={environmentNameDraft}
                                  onChange={(event) => setEnvironmentNameDraft(event.target.value)}
                                  placeholder="Environment name"
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    disabled={workspaceBusy}
                                    onClick={() => void handleRenameEnvironment(environment.id)}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setRenamingEnvironmentId(null);
                                      setEnvironmentNameDraft("");
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <div className="rounded-xl border border-border bg-background/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Active environment network
                          </p>
                          <p className="text-xs text-muted-foreground">
                            The current workspace environment is locked to this chain and contract set.
                          </p>
                        </div>
                        <Badge variant="outline">{configuredChainLabel}</Badge>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-border bg-secondary/30 p-3">
                          <p className="text-xs text-muted-foreground">Chain ID</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {configuredChainId}
                          </p>
                        </div>
                        <div className="rounded-lg border border-border bg-secondary/30 p-3">
                          <p className="text-xs text-muted-foreground">USDC</p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <code className="truncate text-sm text-foreground">
                              {activeUsdcAddress}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 shrink-0"
                              onClick={() =>
                                handleCopyAddress(
                                  "Active USDC",
                                  activeUsdcAddress,
                                )
                              }
                            >
                              {copiedAddress === "Active USDC" ? (
                                <Check className="w-3.5 h-3.5 text-success" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </Button>
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-secondary/30 p-3">
                          <p className="text-xs text-muted-foreground">Plan Factory</p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <code className="truncate text-sm text-foreground">
                              {activePlanFactoryAddress ?? "Not deployed"}
                            </code>
                            {activePlanFactoryAddress ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 shrink-0"
                                onClick={() =>
                                  handleCopyAddress(
                                    "Plan Factory",
                                    activePlanFactoryAddress,
                                  )
                                }
                              >
                                {copiedAddress === "Plan Factory" ? (
                                  <Check className="w-3.5 h-3.5 text-success" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-secondary/30 p-3">
                          <p className="text-xs text-muted-foreground">Subscription Registry</p>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <code className="truncate text-sm text-foreground">
                              {activeSubscriptionRegistryAddress ?? "Not deployed"}
                            </code>
                            {activeSubscriptionRegistryAddress ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 shrink-0"
                                onClick={() =>
                                  handleCopyAddress(
                                    "Subscription Registry",
                                    activeSubscriptionRegistryAddress,
                                  )
                                }
                              >
                                {copiedAddress === "Subscription Registry" ? (
                                  <Check className="w-3.5 h-3.5 text-success" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Team members</p>
                        <p className="text-xs text-muted-foreground">
                          People with access to this workspace right now.
                        </p>
                      </div>
                      <Badge variant="secondary">
                        <Users className="w-3.5 h-3.5 mr-1" />
                        {teamInfo.members.length}
                      </Badge>
                    </div>
                    <div className="space-y-3">
                      {teamInfo.members.map((member) => {
                        const label =
                          member.email ||
                          member.walletAddress ||
                          member.userId;
                        const isSelf = sessionData?.user.id === member.userId;
                        return (
                          <div
                            key={member.id}
                            className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/30 p-4 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {member.email ?? "Wallet-only member"}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{member.role}</span>
                                {member.walletAddress ? (
                                  <span className="font-mono">
                                    {member.walletAddress.slice(0, 6)}…{member.walletAddress.slice(-4)}
                                  </span>
                                ) : null}
                                <span>
                                  Joined {new Date(member.joinedAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            {canManageWorkspace && member.role !== "OWNER" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                disabled={workspaceBusy || isSelf}
                                onClick={() => void handleRemoveMember(member.userId, label)}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-2" />
                                {isSelf ? "Current user" : "Remove"}
                              </Button>
                            ) : (
                              <Badge variant="outline" className="shrink-0">
                                {member.role === "OWNER" ? "Owner" : "Managed"}
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-4 rounded-xl border border-border bg-secondary/20 p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground flex items-center gap-2">
                        <UserPlus className="w-4 h-4 text-accent" />
                        Invite teammates
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Send an email invitation with the correct workspace access.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                      <div className="space-y-2">
                        <Label htmlFor="inviteEmail">Email</Label>
                        <Input
                          id="inviteEmail"
                          type="email"
                          placeholder="teammate@company.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          disabled={!canManageWorkspace || workspaceBusy}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="inviteRole">Role</Label>
                        <select
                          id="inviteRole"
                          value={inviteRole}
                          onChange={(e) =>
                            setInviteRole(
                              e.target.value as
                                | "ADMIN"
                                | "MEMBER"
                                | "FINANCE"
                                | "DEVELOPER"
                                | "SUPPORT",
                            )
                          }
                          disabled={!canManageWorkspace || workspaceBusy}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                        >
                          <option value="MEMBER">Member</option>
                          <option value="ADMIN">Admin</option>
                          <option value="FINANCE">Finance</option>
                          <option value="DEVELOPER">Developer</option>
                          <option value="SUPPORT">Support</option>
                        </select>
                      </div>
                      <div className="flex items-end">
                        <Button
                          className="w-full md:w-auto"
                          disabled={!canManageWorkspace || workspaceBusy}
                          onClick={() => void handleInviteMember()}
                        >
                          <Mail className="w-4 h-4 mr-2" />
                          Send invite
                        </Button>
                      </div>
                    </div>
                    {!canManageWorkspace ? (
                      <p className="text-xs text-muted-foreground">
                        Only workspace owners and admins can invite or remove members.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">Pending invitations</p>
                        <p className="text-xs text-muted-foreground">
                          Invitations that are still active and can be revoked.
                        </p>
                      </div>
                      <Badge variant="outline">{pendingInvites.length}</Badge>
                    </div>
                    {pendingInvites.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                        No pending invitations.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {pendingInvites.map((invite) => (
                          <div
                            key={invite.id}
                            className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/30 p-4 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {invite.emailAddress}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{invite.role}</span>
                                <span>
                                  Sent {new Date(invite.createdAt).toLocaleDateString()}
                                </span>
                                <span>
                                  Expires {new Date(invite.expiresAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            {canManageWorkspace ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                disabled={workspaceBusy}
                                onClick={() =>
                                  void handleRevokeInvite(invite.id, invite.emailAddress)
                                }
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-2" />
                                Revoke
                              </Button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Workspace details could not be loaded right now.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Provider Profile Tab */}
        <TabsContent
          value="profile"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {/* EVM Account Identity — only if user has an EVM wallet */}
          {sessionData?.user.walletAddress && (
            <Card className="border-accent/30 bg-card">
              <CardHeader>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-accent" />
                  EVM Account Identity
                </CardTitle>
                <CardDescription>
                  Your linked wallet is the workspace signing identity used by the dashboard on{" "}
                  <span className="text-foreground font-medium">{SUPPORTED_WALLET_CHAIN_LABEL}</span>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {linkedWallet ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 border border-border">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Linked wallet address</p>
                        <code className="text-sm font-mono text-foreground break-all">{linkedWallet}</code>
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <Badge variant="secondary" className="bg-secondary text-foreground border-border">
                          Linked
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => {
                            navigator.clipboard.writeText(linkedWallet);
                            setCopiedAddress("wallet");
                            setTimeout(() => setCopiedAddress(null), 2000);
                          }}
                        >
                          {copiedAddress === "wallet" ? (
                            <Check className="w-3.5 h-3.5 text-success" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                    {isWrongWalletConnected && connectedAddress && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary border border-border">
                        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">
                          Your connected wallet{" "}
                          <code className="text-foreground">{connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}</code>{" "}
                          differs from your linked account wallet. Switch your wallet to the linked address to interact with on-chain features.
                        </p>
                      </div>
                    )}
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
                      <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground">
                        Keep this wallet connected when you need to sign dashboard transactions on {SUPPORTED_WALLET_CHAIN_LABEL}.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 border border-border">
                      <div>
                        <p className="text-sm font-medium text-foreground">No wallet linked</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Link your wallet to enable on-chain subscriptions, plan management, and usage billing.
                        </p>
                      </div>
                      <Badge variant="secondary" className="bg-secondary text-foreground border-border shrink-0">
                        Not Linked
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.location.href = "/login"}
                    >
                      <Wallet className="w-4 h-4 mr-2" />
                      Link Wallet
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stellar Account Identity — only if user has a Stellar wallet */}
          {sessionData?.user.stellarWalletAddress && (
            <Card className="border-accent/30 bg-card">
              <CardHeader>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-accent" />
                  Stellar Account Identity
                </CardTitle>
                <CardDescription>
                  Your linked Stellar wallet is used for Soroban smart contract interactions on Stellar Testnet / Mainnet.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 border border-border">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Linked Stellar address</p>
                      <code className="text-sm font-mono text-foreground break-all">{sessionData.user.stellarWalletAddress}</code>
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      <Badge variant="secondary" className="bg-secondary text-foreground border-border">
                        Linked
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          navigator.clipboard.writeText(sessionData.user.stellarWalletAddress!);
                          setCopiedAddress("stellar");
                          setTimeout(() => setCopiedAddress(null), 2000);
                        }}
                      >
                        {copiedAddress === "stellar" ? (
                          <Check className="w-3.5 h-3.5 text-success" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
                    <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Keep your Freighter wallet connected when you need to sign Stellar transactions.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Solana Account Identity — only if user has a Solana wallet */}
          {sessionData?.user.solanaWalletAddress && (
            <Card className="border-accent/30 bg-card">
              <CardHeader>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-accent" />
                  Solana Account Identity
                </CardTitle>
                <CardDescription>
                  Your linked Solana wallet is used for Anchor program interactions on Solana Devnet.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/50 border border-border">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Linked Solana address</p>
                      <code className="text-sm font-mono text-foreground break-all">{sessionData.user.solanaWalletAddress}</code>
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      <Badge variant="secondary" className="bg-secondary text-foreground border-border">
                        Linked
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          navigator.clipboard.writeText(sessionData.user.solanaWalletAddress!);
                          setCopiedAddress("solana");
                          setTimeout(() => setCopiedAddress(null), 2000);
                        }}
                      >
                        {copiedAddress === "solana" ? (
                          <Check className="w-3.5 h-3.5 text-success" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
                    <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Keep your Phantom or Solflare wallet connected when you need to sign Solana transactions.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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
                  <Label htmlFor="legalName">Legal Business Name</Label>
                  <Input
                    id="legalName"
                    placeholder="Arcen Labs Private Limited"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billingEmail">Billing Email</Label>
                  <Input
                    id="billingEmail"
                    type="email"
                    placeholder="accounts@example.com"
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supportEmail">Support Email</Label>
                  <Input
                    id="supportEmail"
                    type="email"
                    placeholder="support@example.com"
                    value={supportEmail}
                    onChange={(e) => setSupportEmail(e.target.value)}
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supportPhone">Support Phone</Label>
                  <Input
                    id="supportPhone"
                    placeholder="+91 98765 43210"
                    value={supportPhone}
                    onChange={(e) => setSupportPhone(e.target.value)}
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="supportUrl">Support Site</Label>
                  <Input
                    id="supportUrl"
                    placeholder="https://example.com/support"
                    value={supportUrl}
                    onChange={(e) => setSupportUrl(e.target.value)}
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chainId">Network</Label>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {getChainLabel(chainId)}{" "}
                      (Chain ID: {chainId})
                    </span>
                  </div>
                </div>
              </div>
              <div className="space-y-4 rounded-lg border border-border bg-secondary/20 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Billing Identity
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    These details appear on invoice PDFs, receipt PDFs, and
                    payment emails for this workspace environment.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="addressLine1">Address Line 1</Label>
                    <Input
                      id="addressLine1"
                      placeholder="Street address"
                      value={addressLine1}
                      onChange={(e) => setAddressLine1(e.target.value)}
                      className="bg-secondary border-border focus:border-accent"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="addressLine2">Address Line 2</Label>
                    <Input
                      id="addressLine2"
                      placeholder="Suite, district, landmark"
                      value={addressLine2}
                      onChange={(e) => setAddressLine2(e.target.value)}
                      className="bg-secondary border-border focus:border-accent"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      placeholder="Bhubaneswar"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="bg-secondary border-border focus:border-accent"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="stateProvince">State / Province</Label>
                    <Input
                      id="stateProvince"
                      placeholder="Odisha"
                      value={stateProvince}
                      onChange={(e) => setStateProvince(e.target.value)}
                      className="bg-secondary border-border focus:border-accent"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="postalCode">Postal Code</Label>
                    <Input
                      id="postalCode"
                      placeholder="752050"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="bg-secondary border-border focus:border-accent"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country">Country Code</Label>
                    <Input
                      id="country"
                      placeholder="IN"
                      value={country}
                      onChange={(e) => setCountry(e.target.value.toUpperCase())}
                      maxLength={2}
                      className="bg-secondary border-border focus:border-accent uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="taxId">Tax ID</Label>
                    <Input
                      id="taxId"
                      placeholder="Business tax identifier"
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      className="bg-secondary border-border focus:border-accent"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gstin">GSTIN</Label>
                    <Input
                      id="gstin"
                      placeholder="22AAAAA0000A1Z5"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase())}
                      className="bg-secondary border-border focus:border-accent uppercase"
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Workspace Network
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Current mode:{" "}
                      <span className="font-mono text-foreground">
                        {environmentMode}
                      </span>
                    </p>
                  </div>
                  <Badge variant="outline">{configuredChainLabel}</Badge>
                </div>
                <div className="mt-3 rounded-md border border-border bg-background/60 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    This environment is pinned to {configuredChainLabel}. To use
                    another network, create a separate environment instead of
                    changing this one.
                  </p>
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
                {getChainLabel(configuredChainId)}.
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
                                configuredChainId,
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
          {/* Email Notification Toggles */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Email Notifications
              </CardTitle>
              <CardDescription>
                Choose which billing and protocol events trigger an email to
                your contact address. To configure webhook delivery for these
                events, go to{" "}
                <strong className="text-foreground">
                  Connections → Webhooks
                </strong>
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr,80px] gap-4 pb-3 border-b border-border text-sm text-muted-foreground">
                  <span>Event Type</span>
                  <span className="text-center">Email</span>
                </div>
                {notifications.map((notification, index) => (
                  <div
                    key={notification.id}
                    className="grid grid-cols-[1fr,80px] gap-4 py-4 border-b border-border last:border-0 animate-in fade-in slide-in-from-left-2"
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
                  </div>
                ))}
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
                      ? "bg-secondary text-foreground border-border"
                      : "bg-secondary text-foreground border-border"
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
                            ? "bg-secondary text-foreground border-border"
                            : "bg-secondary text-foreground border-border"
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
          <Card className="border-border bg-card">
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
                  className="flex items-center justify-between p-4 rounded-lg bg-secondary border border-border"
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
                    className="border-border text-destructive hover:bg-secondary shrink-0"
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

        {/* API Keys Tab */}
        <TabsContent
          value="protocolkeys"
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/5 border border-accent/20">
            <Key className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">API Keys — for your backend SDK</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use these keys to authenticate your server-side SDK and backend API calls to ArcenPay —
                feature flag checks, event tracking, company management, usage queries, and access token generation.
                Pass as <code className="text-foreground">Authorization: Bearer sk_/pk_/rk_…</code> on all{" "}
                <code className="text-foreground">/api/v1/*</code> endpoints. Keys are shown only once on creation.{" "}
                <span className="text-foreground font-medium">For webhook verification</span>, use the signing
                secret from <strong>Connections → Webhooks</strong>.
              </p>
            </div>
          </div>
          <ProtocolKeysPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
