"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./layout.module.css";

interface Config {
  demoCompanyWallet: string;
  baseUrl: string;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d: Config) => setConfig(d))
      .catch(() => {});
  }, []);

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  const NAV_ITEMS = [
    { href: "/dashboard", icon: "▦", label: "Overview" },
    { href: "/dashboard/scan", icon: "◈", label: "New Scan" },
    { href: "/dashboard/documents", icon: "◇", label: "Documents" },
  ];

  const ACCOUNT_ITEMS = [
    { href: "/dashboard/billing", icon: "◆", label: "Billing & Plan" },
    { href: "/dashboard/settings", icon: "⚙", label: "Settings" },
  ];

  const wallet = config?.demoCompanyWallet;
  const walletShort = wallet
    ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
    : "—";

  return (
    <div className={styles.root}>
      {/* Mobile top bar */}
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
          <span /><span /><span />
        </button>
      </div>

      {/* Overlay */}
      {sidebarOpen && (
        <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
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

          <div className={styles.navSection}>
            <div className={styles.navLabel}>Account</div>
            {ACCOUNT_ITEMS.map((item) => (
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
          <div className={styles.walletChip}>
            <div className={styles.walletDot} />
            <span className={styles.walletAddr}>{walletShort}</span>
          </div>
          <a
            href={config?.baseUrl ?? "http://localhost:3000"}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.arcenBadge}
          >
            <span className={styles.arcenBadgeMark}>⬡</span>
            Powered by ArcenPay
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
