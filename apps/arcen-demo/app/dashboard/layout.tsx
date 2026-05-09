"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { resolveDemoArcenPayBaseUrl } from "@/lib/arcenpay-origin";
import { useWallet } from "./useWallet";
import WalletChip from "./wallet-chip";
import styles from "./layout.module.css";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const { isConnected, connecting, connect } = useWallet();
  const dashboardUrl = resolveDemoArcenPayBaseUrl();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  const NAV_ITEMS = [
    { href: "/dashboard", icon: "▦", label: "Overview" },
    { href: "/dashboard/sdk", icon: "◌", label: "SDK Showcase" },
    { href: "/dashboard/billing", icon: "◆", label: "Billing & Plan" },
    { href: "/dashboard/settings", icon: "⚙", label: "Settings" },
  ];

  return (
    <div className={styles.root}>
      <div className={styles.mobileTopBar}>
        <div className={styles.mobileBrand}>
          <div className={styles.brandMark}>S</div>
          ScanBot
        </div>
        <button
          className={styles.hamburger}
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {sidebarOpen && (
        <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}
      >
        <div className={styles.sidebarTop}>
          <div className={styles.sidebarBrand}>
            <div className={styles.brandMark}>S</div>
            <span className={styles.brandName}>ScanBot</span>
          </div>
          <button
            className={styles.sidebarClose}
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <nav className={styles.nav}>
          <div className={styles.navSection}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${isActive(item.href) ? styles.navItemActive : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className={styles.sidebarFooter}>
          <WalletChip />
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.arcenBadge}
          >
            <span className={styles.arcenBadgeMark}>⬡</span>Powered by ArcenPay
          </a>
        </div>
      </aside>

      <main className={styles.main}>
        {connecting ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "60vh",
              flexDirection: "column",
              gap: 16,
              color: "var(--text-muted, #9ca3af)",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                border: "3px solid var(--surface-secondary, #e5e7eb)",
                borderTopColor: "var(--accent, #6366f1)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <span>Connecting wallet…</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        ) : !isConnected ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "60vh",
              gap: 20,
              padding: 40,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: "var(--surface-secondary, #1f2937)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
              }}
            >
              ⬡
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              Connect Your Wallet
            </h2>
            <p
              style={{
                color: "var(--text-muted, #9ca3af)",
                fontSize: 14,
                textAlign: "center",
                maxWidth: 400,
                lineHeight: 1.7,
              }}
            >
              Connect your wallet to access the ScanBot dashboard, manage your
              subscription, and track usage.
            </p>
            <button
              onClick={connect}
              style={{
                padding: "12px 28px",
                background: "var(--accent, #6366f1)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Connect Wallet
            </button>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
