"use client";

import { ArrowUpRight, Activity } from "lucide-react";

export function RecentActivity() {
    return (
        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h3 className="text-base font-semibold text-foreground">Recent Activity</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">On-chain events</p>
                </div>
                <button className="flex items-center gap-1 text-sm text-accent hover:text-accent/80 font-medium transition-colors group">
                    View all
                    <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </button>
            </div>

            {/* Empty state */}
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-4">
                    <Activity className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">No recent activity</p>
                <p className="text-xs text-muted-foreground max-w-[240px]">
                    On-chain events like subscriptions, renewals, and settlements will appear here
                </p>
            </div>
        </div>
    );
}
