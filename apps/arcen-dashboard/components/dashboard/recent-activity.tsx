"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Activity } from "lucide-react";

type ProofHistoryJob = {
    sessionId: string;
    status: string;
    callCount: number;
    settlementAmount?: string;
    createdAt: number;
    txHash?: string;
};

const FACILITATOR_URL =
    process.env.NEXT_PUBLIC_FACILITATOR_BASE_URL ||
    process.env.NEXT_PUBLIC_FACILITATOR_URL ||
    "http://localhost:3402";

export function RecentActivity() {
    const [jobs, setJobs] = useState<ProofHistoryJob[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const fetchActivity = async () => {
            try {
                setLoading(true);
                const response = await fetch(`${FACILITATOR_URL}/api/proofs/history?limit=8`);
                if (!response.ok) return;
                const payload = await response.json();
                if (!cancelled) {
                    setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
                }
            } catch {
                if (!cancelled) {
                    setJobs([]);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void fetchActivity();
        const interval = setInterval(() => {
            void fetchActivity();
        }, 30_000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

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

            {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                    Loading activity...
                </div>
            ) : jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-4">
                        <Activity className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">No recent activity</p>
                    <p className="text-xs text-muted-foreground max-w-[240px]">
                        On-chain events like subscriptions, renewals, and settlements will appear here
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {jobs.map((job) => (
                        <div
                            key={`${job.sessionId}-${job.createdAt}-${job.status}`}
                            className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-3 py-2"
                        >
                            <div>
                                <p className="text-sm font-medium text-foreground">
                                    {job.status === "submitted" ? "Settlement submitted" : "Proof job updated"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {new Date(job.createdAt).toLocaleString()} · {job.callCount} calls
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm text-foreground">
                                    {job.settlementAmount ? `$${(Number(job.settlementAmount) / 1e6).toFixed(2)}` : "—"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {job.txHash ? `${job.txHash.slice(0, 8)}…` : "pending"}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
