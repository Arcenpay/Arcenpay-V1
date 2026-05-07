"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "./dashboard/useWallet";
import styles from "./page.module.css";

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isConnected, connect, shortAddr } = useWallet();

  return (
    <div className={styles.root}>
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <div className={styles.navLogoMark}>S</div>
          <span className={styles.navName}>ScanBot</span>
          <span className={styles.navBadge}>Demo</span>
        </div>
        <div className={`${styles.navLinks} ${menuOpen ? styles.open : ""}`}>
          {isConnected ? (
            <>
              <span className={styles.navLink} style={{ opacity: 0.7, fontSize: 13 }}>{shortAddr}</span>
              <Link href="/dashboard" className={styles.navLink} onClick={() => setMenuOpen(false)}>Dashboard</Link>
              <Link href="/dashboard/billing" className={styles.btnPrimary} onClick={() => setMenuOpen(false)}>Billing →</Link>
            </>
          ) : (
            <>
              <Link href="/dashboard" className={styles.navLink} onClick={() => setMenuOpen(false)}>Dashboard</Link>
              <button className={styles.btnPrimary} onClick={connect}>Connect Wallet</button>
            </>
          )}
        </div>
        <button className={styles.hamburger} onClick={() => setMenuOpen((o) => !o)} aria-label="Toggle menu">
          <span /><span /><span />
        </button>
      </nav>

      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>AI-Powered Document Scanning</h1>
        <p className={styles.heroSub}>
          ScanBot uses ArcenPay for Web3-native subscription billing. Connect your wallet, pick a plan, and start scanning.
        </p>
        <div className={styles.heroCta}>
          {isConnected ? (
            <Link href="/dashboard" className={styles.btnPrimary} style={{ fontSize: 16, padding: "14px 32px" }}>
              Open Dashboard →
            </Link>
          ) : (
            <button onClick={connect} className={styles.btnPrimary} style={{ fontSize: 16, padding: "14px 32px", border: "none" }}>
              Connect Wallet to Start
            </button>
          )}
          <Link href="/dashboard/billing" className={styles.btnSecondary} style={{ fontSize: 16, padding: "14px 32px" }}>
            View Plans
          </Link>
        </div>
      </section>

      <section className={styles.features}>
        <h2 className={styles.sectionTitle}>Why ScanBot?</h2>
        <div className={styles.featureGrid}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📄</div>
            <h3 className={styles.featureTitle}>Smart OCR</h3>
            <p className={styles.featureDesc}>AI-powered text extraction from any document. Upload PDFs, images, or screenshots.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🔒</div>
            <h3 className={styles.featureTitle}>Web3 Billing</h3>
            <p className={styles.featureDesc}>Subscribe with USDC on-chain. No credit cards. Powered by ArcenPay.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📊</div>
            <h3 className={styles.featureTitle}>Usage Tracking</h3>
            <p className={styles.featureDesc}>Real-time metered usage. Track every scan against your plan limits.</p>
          </div>
        </div>
      </section>

      <section className={styles.pricing}>
        <h2 className={styles.sectionTitle}>Simple Pricing</h2>
        <p className={styles.sectionSub}>Choose a plan that fits your scanning volume. All plans billed monthly in USDC.</p>
        <div className={styles.pricingGrid}>
          <div className={styles.pricingCard}>
            <h3 className={styles.pricingName}>Starter</h3>
            <div className={styles.pricingPrice}>$9<span className={styles.pricingPer}>/mo</span></div>
            <ul className={styles.pricingFeatures}>
              <li className={styles.pricingFeature}>100 scans / month</li>
              <li className={styles.pricingFeature}>PDF export</li>
              <li className={styles.pricingFeature}>Email support</li>
            </ul>
          </div>
          <div className={`${styles.pricingCard} ${styles.pricingFeatured}`}>
            <h3 className={styles.pricingName}>Pro</h3>
            <div className={styles.pricingPrice}>$29<span className={styles.pricingPer}>/mo</span></div>
            <ul className={styles.pricingFeatures}>
              <li className={styles.pricingFeature}>1,000 scans / month</li>
              <li className={styles.pricingFeature}>PDF + CSV export</li>
              <li className={styles.pricingFeature}>API access</li>
              <li className={styles.pricingFeature}>Priority support</li>
            </ul>
          </div>
          <div className={styles.pricingCard}>
            <h3 className={styles.pricingName}>Enterprise</h3>
            <div className={styles.pricingPrice}>$99<span className={styles.pricingPer}>/mo</span></div>
            <ul className={styles.pricingFeatures}>
              <li className={styles.pricingFeature}>Unlimited scans</li>
              <li className={styles.pricingFeature}>All exports</li>
              <li className={styles.pricingFeature}>Full API access</li>
              <li className={styles.pricingFeature}>Dedicated support</li>
            </ul>
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <Link href="/dashboard/billing" className={styles.btnPrimary}>
            View Plans & Subscribe →
          </Link>
        </div>
      </section>
    </div>
  );
}
