import Link from "next/link";
import styles from "./layout.module.css";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.root}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <span className={styles.brandIcon}>⬡</span>
          <span className={styles.brandName}>ScanBot</span>
        </div>

        <nav className={styles.nav}>
          <div className={styles.navSection}>
            <Link href="/dashboard" className={styles.navItem}>
              <span className={styles.navIcon}>◈</span>
              Overview
            </Link>
            <Link href="/dashboard/scan" className={styles.navItem}>
              <span className={styles.navIcon}>◉</span>
              New Scan
            </Link>
            <Link href="/dashboard/documents" className={styles.navItem}>
              <span className={styles.navIcon}>◇</span>
              Documents
            </Link>
          </div>

          <div className={styles.navSection}>
            <div className={styles.navLabel}>Account</div>
            <Link href="/dashboard/billing" className={styles.navItem}>
              <span className={styles.navIcon}>◆</span>
              Billing & Plan
            </Link>
            <Link href="/dashboard/settings" className={styles.navItem}>
              <span className={styles.navIcon}>◎</span>
              Settings
            </Link>
          </div>
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.sidebarFooterLabel}>Powered by</div>
          <a
            href="http://localhost:3000"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.arcenBadge}
          >
            ⬡ ArcenPay
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
