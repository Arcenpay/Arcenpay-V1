"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
    Search,
    ArrowUpDown,
    Users,
    Download,
    Copy,
    Check,
    AlertCircle,
    RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import { useQuery } from "@apollo/client";
import { GET_PROVIDER_PLANS, GET_SUBSCRIBERS } from "@/lib/graphql";
import { truncateAddress, formatRelativeTime, formatAbsoluteTime } from "@/lib/format";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface GqlSubscription {
    id: string;
    subscriber: string;
    plan: { id: string; name: string; tier: string; price: string };
    expiration: string;
    isActive: boolean;
    mintedAt: string;
    amountPaid: string;
    txHash: string;
}

type SubscriberStatus = "active" | "expiring" | "expired";

function getStatus(expiresAt: number): SubscriberStatus {
    const now = Date.now() / 1000;
    if (expiresAt < now) return "expired";
    if (expiresAt - now < 7 * 86400) return "expiring";
    return "active";
}

function StatusBadge({ status }: { status: SubscriberStatus }) {
    const map = {
        active: "bg-success/10 text-success border-success/20",
        expiring: "bg-warning/10 text-warning border-warning/20",
        expired: "bg-secondary text-muted-foreground",
    } as const;
    return (
        <Badge variant="secondary" className={cn("text-xs capitalize", map[status])}>
            {status}
        </Badge>
    );
}

function SkeletonRow() {
    return (
        <tr className="border-b border-border">
            {Array.from({ length: 5 }).map((_, i) => (
                <td key={i} className="py-3 px-4">
                    <div className="h-4 bg-secondary/80 rounded animate-pulse w-24" />
                </td>
            ))}
        </tr>
    );
}

export function SubscribersSection() {
    const { address, isConnected } = useAccount();
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedFilter, setSelectedFilter] = useState<string>("all");
    const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

    // Fetch provider's plan IDs first
    const { data: plansData } = useQuery(GET_PROVIDER_PLANS, {
        variables: { provider: address?.toLowerCase() },
        skip: !isConnected || !address,
    });

    const planIds: string[] = (plansData?.plans ?? []).map((p: { id: string }) => p.id);

    // Fetch subscribers for those plans
    const {
        data: subsData,
        loading,
        error,
        refetch,
    } = useQuery(GET_SUBSCRIBERS, {
        variables: { provider: address?.toLowerCase(), planIds },
        skip: !isConnected || !address || planIds.length === 0,
    });

    const allSubs: GqlSubscription[] = subsData?.subscriptions ?? [];

    // Filter
    const filtered = allSubs.filter((s) => {
        const expiresAt = parseInt(s.expiration);
        const status = getStatus(expiresAt);

        const matchesSearch =
            s.subscriber.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesFilter =
            selectedFilter === "all" || status === selectedFilter;
        return matchesSearch && matchesFilter;
    });

    const handleCopyAddress = (addr: string) => {
        navigator.clipboard.writeText(addr);
        setCopiedAddress(addr);
        setTimeout(() => setCopiedAddress(null), 2000);
    };

    const handleExportCSV = () => {
        const rows = [
            ["Wallet", "Plan", "Tier", "ExpiresAt", "Status", "AmountPaid", "TxHash"],
            ...filtered.map((s) => {
                const expiresAt = parseInt(s.expiration);
                return [
                    s.subscriber,
                    s.plan.name,
                    s.plan.tier,
                    new Date(expiresAt * 1000).toISOString(),
                    getStatus(expiresAt),
                    s.amountPaid,
                    s.txHash,
                ];
            }),
        ];
        const csv = rows.map((r) => r.join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "subscribers.csv";
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <TooltipProvider>
        <div className="space-y-6">
            {/* Header */}
            <div>
                <p className="text-sm text-muted-foreground">View and manage all your subscribers</p>
            </div>

            {/* Filters and search */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search by wallet address..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-72 h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        {["all", "active", "expiring", "expired"].map((filter) => (
                            <button
                                key={filter}
                                onClick={() => setSelectedFilter(filter)}
                                className={cn(
                                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                                    selectedFilter === filter
                                        ? "bg-accent text-accent-foreground"
                                        : "bg-secondary text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {filter.charAt(0).toUpperCase() + filter.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    onClick={handleExportCSV}
                    disabled={filtered.length === 0}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 disabled:opacity-50"
                >
                    <Download className="w-4 h-4" />
                    Export CSV
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/5 border border-destructive/20">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                    <p className="text-sm text-muted-foreground flex-1">Failed to load subscribers: {error.message}</p>
                    <Button variant="ghost" size="sm" onClick={() => refetch()} className="shrink-0">
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        Retry
                    </Button>
                </div>
            )}

            {/* Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border bg-secondary/50">
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                                        Wallet Address
                                        <ArrowUpDown className="w-3 h-3" />
                                    </button>
                                </th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plan Tier</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                                        Expires At
                                        <ArrowUpDown className="w-3 h-3" />
                                    </button>
                                </th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Token ID</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
                            {!loading && filtered.map((sub, index) => {
                                const expiresAt = parseInt(sub.expiration);
                                const status = getStatus(expiresAt);
                                return (
                                    <tr
                                        key={sub.id}
                                        className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors animate-in fade-in slide-in-from-left-2"
                                        style={{ animationDelay: `${index * 40}ms`, animationFillMode: "both" }}
                                    >
                                        <td className="py-3 px-4">
                                            <div className="flex items-center gap-2">
                                                <code className="text-xs font-mono text-foreground">
                                                    {truncateAddress(sub.subscriber)}
                                                </code>
                                                <button
                                                    onClick={() => handleCopyAddress(sub.subscriber)}
                                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                                    title="Copy address"
                                                >
                                                    {copiedAddress === sub.subscriber ? (
                                                        <Check className="w-3 h-3 text-success" />
                                                    ) : (
                                                        <Copy className="w-3 h-3" />
                                                    )}
                                                </button>
                                            </div>
                                        </td>
                                        <td className="py-3 px-4">
                                            <Badge variant="secondary" className="text-xs">
                                                {sub.plan.tier}
                                            </Badge>
                                        </td>
                                        <td className="py-3 px-4">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="text-sm text-muted-foreground cursor-default">
                                                        {formatRelativeTime(expiresAt)}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p className="text-xs">{formatAbsoluteTime(expiresAt)}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </td>
                                        <td className="py-3 px-4">
                                            <StatusBadge status={status} />
                                        </td>
                                        <td className="py-3 px-4">
                                            <code className="text-xs text-muted-foreground font-mono">#{sub.id}</code>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Empty state */}
                {!loading && !error && filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
                            <Users className="w-7 h-7 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium text-foreground mb-1">
                            {!isConnected ? "Connect your wallet" : "No subscribers yet"}
                        </p>
                        <p className="text-xs text-muted-foreground max-w-[320px]">
                            {!isConnected
                                ? "Connect to see your subscribers from The Graph"
                                : "Subscribers will appear here once users mint subscription NFTs to your plans via the CheckoutModal"}
                        </p>
                    </div>
                )}

                {/* Pagination footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
                    <span className="text-sm text-muted-foreground">
                        Showing {filtered.length} subscriber{filtered.length !== 1 ? "s" : ""}
                        {allSubs.length !== filtered.length && ` (${allSubs.length} total)`}
                    </span>
                </div>
            </div>
        </div>
        </TooltipProvider>
    );
}
