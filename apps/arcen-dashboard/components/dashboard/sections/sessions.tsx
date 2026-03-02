"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
    Cpu,
    DollarSign,
    Shield,
    Zap,
} from "lucide-react";

export function SessionsSection() {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <p className="text-sm text-muted-foreground">
                    Monitor ZKVUB agent sessions, vault balances, and proof settlements
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                    {
                        label: "Active Sessions",
                        value: "0",
                        icon: Cpu,
                        color: "text-chart-1",
                    },
                    {
                        label: "Total Settled",
                        value: "$0.00",
                        icon: DollarSign,
                        color: "text-accent",
                    },
                    {
                        label: "Pending Proofs",
                        value: "0",
                        icon: Shield,
                        color: "text-chart-3",
                    },
                ].map((stat, index) => (
                    <Card
                        key={stat.label}
                        className="border-border bg-card hover:border-muted-foreground/30 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4"
                        style={{ animationDelay: `${index * 75}ms`, animationFillMode: "both" }}
                    >
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                                    <p className={`text-2xl font-semibold mt-1 ${stat.color}`}>
                                        {stat.value}
                                    </p>
                                </div>
                                <stat.icon className={`w-8 h-8 ${stat.color} opacity-50`} />
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Sessions Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border bg-secondary/50">
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Agent Address
                                </th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Vault Balance
                                </th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Call Count
                                </th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Proof Status
                                </th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Last Settlement
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* Empty — no mock data */}
                        </tbody>
                    </table>
                </div>

                {/* Empty state */}
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
                        <Zap className="w-7 h-7 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">No active sessions</p>
                    <p className="text-xs text-muted-foreground max-w-[360px]">
                        Agent sessions will appear here once agents fund their session vaults and begin making x402 authenticated API calls
                    </p>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
                    <span className="text-sm text-muted-foreground">
                        Showing 0 sessions
                    </span>
                </div>
            </div>

            {/* Proof Submission Log */}
            <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
                <div className="mb-5">
                    <h3 className="text-base font-semibold text-foreground">Proof Submission Log</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        History of ZKUsageVerifier.BillingSettled events
                    </p>
                </div>

                <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-3">
                        <Shield className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">No proof submissions yet</p>
                    <p className="text-xs text-muted-foreground max-w-[300px]">
                        zk-SNARK proof settlements will be logged here
                    </p>
                </div>
            </div>
        </div>
    );
}
