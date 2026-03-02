"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
    Plus,
    Layers,
    Search,
    MoreHorizontal,
} from "lucide-react";

export function PlansSection() {
    const [searchQuery, setSearchQuery] = useState("");

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <p className="text-sm text-muted-foreground">Create and manage your subscription plans</p>
                </div>
                <button className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors duration-200">
                    <Plus className="w-4 h-4" />
                    Create Plan
                </button>
            </div>

            {/* Search */}
            <div className="flex items-center gap-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search plans..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-64 h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
                    />
                </div>
                <div className="flex items-center gap-2">
                    {["All", "Active", "Archived"].map((filter) => (
                        <button
                            key={filter}
                            className={cn(
                                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                                filter === "All"
                                    ? "bg-accent text-accent-foreground"
                                    : "bg-secondary text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {filter}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border bg-secondary/50">
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Plan Name
                                </th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Price (USDC)
                                </th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Interval
                                </th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Subscribers
                                </th>
                                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="w-12"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* Empty state */}
                        </tbody>
                    </table>
                </div>

                {/* Empty state */}
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
                        <Layers className="w-7 h-7 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">No plans created yet</p>
                    <p className="text-xs text-muted-foreground max-w-[320px] mb-4">
                        Create your first subscription plan to start accepting subscribers through the ArcenPay protocol
                    </p>
                    <button className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors duration-200">
                        <Plus className="w-4 h-4" />
                        Create Your First Plan
                    </button>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
                    <span className="text-sm text-muted-foreground">
                        Showing 0 plans
                    </span>
                </div>
            </div>
        </div>
    );
}
