"use client";

import { useAccount } from "wagmi";
import { getContractAddresses, TOKENS } from "@meap/core";
import {
    CHAIN_ID,
    truncateAddress,
    getExplorerUrl,
} from "@/lib/contracts";

const contracts = getContractAddresses(CHAIN_ID);

const DEPLOYED_CONTRACTS: Record<string, string> = {
    PlanFactory: contracts.planFactory,
    SubscriptionRegistry: contracts.subscriptionRegistry,
    FeeCollector: contracts.feeCollector,
    SessionVault: contracts.sessionVault,
    ZKUsageVerifier: contracts.zkUsageVerifier,
    AutopayModule: contracts.autopayModule,
    ...(contracts.mirrorRegistry
        ? { MirrorRegistry: contracts.mirrorRegistry }
        : {}),
};

const USDC_ADDRESS =
    TOKENS[CHAIN_ID as keyof typeof TOKENS]?.USDC || "Not configured";

export default function SettingsPage() {
    const { address } = useAccount();

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <>
            <div className="page-header">
                <h1>Settings</h1>
                <p>Provider configuration and contract addresses</p>
            </div>

            {/* Provider Profile */}
            <div className="data-table" style={{ marginBottom: 24 }}>
                <div className="table-header">
                    <h3>Provider Profile</h3>
                    <div className="network-badge">Sepolia ({CHAIN_ID})</div>
                </div>
                <div style={{ padding: 24 }}>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 16,
                        }}
                    >
                        <div>
                            <label className="form-label">Wallet Address</label>
                            <div
                                style={{
                                    display: "flex",
                                    gap: 8,
                                    alignItems: "center",
                                }}
                            >
                                <span className="address" style={{ fontSize: 14 }}>
                                    {address || "Not connected"}
                                </span>
                                {address && (
                                    <button
                                        className="btn"
                                        style={{ fontSize: 11, padding: "4px 8px" }}
                                        onClick={() => copyToClipboard(address)}
                                    >
                                        Copy
                                    </button>
                                )}
                            </div>
                        </div>
                        <div>
                            <label className="form-label">Network</label>
                            <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                                {CHAIN_ID === 11155111
                                    ? "Sepolia Testnet"
                                    : CHAIN_ID === 84532
                                        ? "Base Sepolia"
                                        : CHAIN_ID === 8453
                                            ? "Base Mainnet"
                                            : `Chain ${CHAIN_ID}`}
                            </div>
                        </div>
                        <div>
                            <label className="form-label">USDC Token</label>
                            <div
                                style={{
                                    display: "flex",
                                    gap: 8,
                                    alignItems: "center",
                                }}
                            >
                                <span className="address" style={{ fontSize: 13 }}>
                                    {truncateAddress(USDC_ADDRESS)}
                                </span>
                                <a
                                    href={getExplorerUrl(USDC_ADDRESS, CHAIN_ID, "address")}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ fontSize: 12 }}
                                >
                                    View ↗
                                </a>
                            </div>
                        </div>
                        <div>
                            <label className="form-label">Explorer</label>
                            <a
                                href={
                                    address
                                        ? getExplorerUrl(address, CHAIN_ID, "address")
                                        : "#"
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 13 }}
                            >
                                View Wallet on Explorer ↗
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            {/* Deployed Contracts */}
            <div className="data-table" style={{ marginBottom: 24 }}>
                <div className="table-header">
                    <h3>Deployed Contracts</h3>
                    <span className="badge active">
                        {Object.keys(DEPLOYED_CONTRACTS).length} Contracts
                    </span>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Contract</th>
                            <th>Address</th>
                            <th>Explorer</th>
                            <th>Copy</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Object.entries(DEPLOYED_CONTRACTS).map(([name, addr]) => (
                            <tr key={name}>
                                <td style={{ fontWeight: 600 }}>{name}</td>
                                <td className="address" title={addr}>
                                    {truncateAddress(addr)}
                                </td>
                                <td>
                                    <a
                                        href={getExplorerUrl(addr, CHAIN_ID, "address")}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        View ↗
                                    </a>
                                </td>
                                <td>
                                    <button
                                        className="btn"
                                        style={{ fontSize: 11, padding: "4px 8px" }}
                                        onClick={() => copyToClipboard(addr)}
                                    >
                                        Copy
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Notification Config */}
            <div className="data-table" style={{ marginBottom: 24 }}>
                <div className="table-header">
                    <h3>Notifications</h3>
                    <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                        Webhook & email configuration
                    </span>
                </div>
                <div
                    style={{
                        padding: 24,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 16,
                    }}
                >
                    <div>
                        <label className="form-label">Webhook URL</label>
                        <input
                            type="url"
                            placeholder="https://api.example.com/webhooks/meap"
                            className="form-input"
                            disabled
                        />
                        <span
                            style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                                marginTop: 4,
                                display: "block",
                            }}
                        >
                            Coming in Sprint 3 — HMAC-SHA256 signed payloads
                        </span>
                    </div>
                    <div>
                        <label className="form-label">Webhook Secret</label>
                        <input
                            type="password"
                            placeholder="whsec_..."
                            className="form-input"
                            disabled
                        />
                    </div>
                    <div>
                        <label className="form-label">Email Notifications</label>
                        <input
                            type="email"
                            placeholder="admin@example.com"
                            className="form-input"
                            disabled
                        />
                        <span
                            style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                                marginTop: 4,
                                display: "block",
                            }}
                        >
                            Coming in Sprint 3 — Resend integration
                        </span>
                    </div>
                    <div>
                        <label className="form-label">Notification Events</label>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                                marginTop: 4,
                            }}
                        >
                            {[
                                "subscription.minted",
                                "subscription.renewed",
                                "subscription.cancelled",
                                "session.funded",
                                "settlement.completed",
                            ].map((event) => (
                                <label
                                    key={event}
                                    style={{
                                        display: "flex",
                                        gap: 8,
                                        alignItems: "center",
                                        fontSize: 13,
                                        color: "var(--text-secondary)",
                                    }}
                                >
                                    <input type="checkbox" disabled />
                                    {event}
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Environment Variables Reference */}
            <div className="data-table">
                <div className="table-header">
                    <h3>Environment Variables</h3>
                    <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                        Required .env configuration
                    </span>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Variable</th>
                            <th>Required</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[
                            {
                                name: "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
                                required: true,
                                desc: "WalletConnect Cloud project ID",
                            },
                            {
                                name: "NEXT_PUBLIC_CHAIN_ID",
                                required: false,
                                desc: "Target chain (default: 11155111)",
                            },
                            {
                                name: "NEXT_PUBLIC_FACILITATOR_URL",
                                required: false,
                                desc: "Facilitator API base URL for session telemetry",
                            },
                            {
                                name: "NEXTAUTH_SECRET",
                                required: true,
                                desc: "SIWE session signing secret",
                            },
                            {
                                name: "REDIS_URL",
                                required: false,
                                desc: "Redis for session storage",
                            },
                            {
                                name: "ZERODEV_PROJECT_ID",
                                required: false,
                                desc: "ZeroDev smart account project",
                            },
                            {
                                name: "LIT_NETWORK",
                                required: false,
                                desc: "Lit Protocol network (manzano/habanero)",
                            },
                            {
                                name: "TABLELAND_TABLE_NAME",
                                required: false,
                                desc: "Tableland table used for feature/entitlement state",
                            },
                            {
                                name: "TABLELAND_PRIVATE_KEY",
                                required: false,
                                desc: "Signer key for Tableland write transactions",
                            },
                            {
                                name: "TABLELAND_RPC_URL",
                                required: false,
                                desc: "RPC used by Tableland signer wallet",
                            },
                            {
                                name: "RESEND_API_KEY",
                                required: false,
                                desc: "Email notifications via Resend",
                            },
                            {
                                name: "SENTRY_DSN",
                                required: false,
                                desc: "Error monitoring via Sentry",
                            },
                        ].map((env) => (
                            <tr key={env.name}>
                                <td>
                                    <span
                                        style={{
                                            fontFamily:
                                                "'SF Mono', 'Fira Code', monospace",
                                            fontSize: 12,
                                            color: "var(--accent)",
                                        }}
                                    >
                                        {env.name}
                                    </span>
                                </td>
                                <td>
                                    <span
                                        className={`badge ${env.required ? "active" : ""}`}
                                    >
                                        {env.required ? "Required" : "Optional"}
                                    </span>
                                </td>
                                <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                                    {env.desc}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}
