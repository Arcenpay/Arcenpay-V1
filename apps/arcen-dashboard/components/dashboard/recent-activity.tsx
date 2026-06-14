"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";

type ProofHistoryJob = {
    sessionId: string;
    status: string;
    callCount: number;
    settlementAmount?: string;
    createdAt: number;
    txHash?: string;
};

type ProofHistoryPayload = {
    count: number;
    jobs: ProofHistoryJob[];
    degraded?: boolean;
    message?: string;
    chainMismatch?: {
        requestedChainId: number;
        facilitatorChainId: number;
    };
};

interface RecentActivityProps {
    chainId: number;
    environmentKey: string;
}

export function RecentActivity({ chainId, environmentKey }: RecentActivityProps) {
    const [jobs, setJobs] = useState<ProofHistoryJob[]>([]);
    const [loading, setLoading] = useState(true);
    const [warning, setWarning] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const fetchActivity = async () => {
            try {
                setLoading(true);
                const response = await fetch(`/api/proofs/history?limit=8&chainId=${chainId}`);
                if (!response.ok) return;
                const payload = await response.json() as ProofHistoryPayload;
                if (!cancelled) {
                    setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
                    setWarning(
                        payload.chainMismatch
                            ? (payload.message ?? `Facilitator is connected to chain ${payload.chainMismatch.facilitatorChainId}, so proof activity for chain ${payload.chainMismatch.requestedChainId} is unavailable right now.`)
                            : payload.degraded
                              ? (payload.message ?? "Proof activity is temporarily unavailable.")
                              : null,
                    );
                }
            } catch {
                if (!cancelled) {
                    setJobs([]);
                    setWarning("Proof activity is temporarily unavailable.");
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
    }, [chainId, environmentKey]);

    return (
        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h3 className="text-base font-semibold text-foreground">Recent Proof Activity</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Proof jobs and settlement submissions for chain {chainId}
                    </p>
                </div>
            </div>
            {warning && (
                <div className="mb-4 rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
                    {warning}
                </div>
            )}

            {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                    Loading activity...
                </div>
            ) : jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center mb-4">
                        <Activity className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">No activity yet</p>
                    <p className="text-xs text-muted-foreground max-w-[200px]">
                        Subscriptions and settlements will show up here
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {jobs.map((job) => (
                        <div
                            key={`${job.sessionId}-${job.createdAt}-${job.status}`}
                            className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2"
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
