"use client";

import { useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import styles from "./page.module.css";

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isConnected, address } = useAccount();
  const shortAddr = address
    ? `${address.slice(0, 6)}\u2026${address.slice(-4)}`
    : null;

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
              <Link href="/dashboard/sdk" className={styles.navLink} onClick={() => setMenuOpen(false)}>SDK Showcase</Link>
              <Link href="/dashboard/billing" className={styles.btnPrimary} onClick={() => setMenuOpen(false)}>Billing →</Link>
            </>
          ) : (
            <>
              <Link href="/dashboard" className={styles.navLink} onClick={() => setMenuOpen(false)}>Dashboard</Link>
              <Link href="/dashboard/sdk" className={styles.navLink} onClick={() => setMenuOpen(false)}>SDK Showcase</Link>
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button className={styles.btnPrimary} onClick={openConnectModal}>Connect Wallet</button>
                )}
              </ConnectButton.Custom>
            </>
          )}
        </div>
        <button className={styles.hamburger} onClick={() => setMenuOpen((o) => !o)} aria-label="Toggle menu">
          <span /><span /><span />
        </button>
      </nav>

      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>ArcenPay Demo Studio</h1>
        <p className={styles.heroSub}>
          Explore the public React and Node SDKs in one demo app. See the embed, hooks, entitlements, payment links, server-side client methods, webhooks, and protocol helpers all working together.
        </p>
        <div className={styles.heroCta}>
          {isConnected ? (
            <Link href="/dashboard" className={styles.btnPrimary} style={{ fontSize: 16, padding: "14px 32px" }}>
              Open Dashboard →
            </Link>
          ) : (
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <button onClick={openConnectModal} className={styles.btnPrimary} style={{ fontSize: 16, padding: "14px 32px", border: "none" }}>
                  Connect Wallet to Start
                </button>
              )}
            </ConnectButton.Custom>
          )}
          <Link href="/dashboard/sdk" className={styles.btnSecondary} style={{ fontSize: 16, padding: "14px 32px" }}>
            Explore SDK Showcase
          </Link>
        </div>
      </section>

      <section className={styles.features}>
        <h2 className={styles.sectionTitle}>What this demo covers</h2>
        <div className={styles.featureGrid}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📄</div>
            <h3 className={styles.featureTitle}>React SDK</h3>
            <p className={styles.featureDesc}>Preview `ArcenEmbed`, exercise hooks, test feature gates, and inspect builder helpers in a live browser session.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🔒</div>
            <h3 className={styles.featureTitle}>Node SDK</h3>
            <p className={styles.featureDesc}>Run `ArcenClient` methods, verify webhooks, inspect protocol events, and understand the backend service surface.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📊</div>
            <h3 className={styles.featureTitle}>Managed Billing UI</h3>
            <p className={styles.featureDesc}>Jump from the showcase into the full billing portal to see what an end-user integration looks like.</p>
          </div>
        </div>
      </section>

      <section className={styles.pricing}>
        <h2 className={styles.sectionTitle}>Suggested demo path</h2>
        <p className={styles.sectionSub}>Walk through the SDK from high level to hands-on: learn the surface, try the managed UI, then inspect backend actions.</p>
        <div className={styles.pricingGrid}>
          <div className={styles.pricingCard}>
            <h3 className={styles.pricingName}>1. Read the Overview</h3>
            <div className={styles.pricingPrice}>Start<span className={styles.pricingPer}> here</span></div>
            <ul className={styles.pricingFeatures}>
              <li className={styles.pricingFeature}>Understand the platform</li>
              <li className={styles.pricingFeature}>Connect your wallet</li>
              <li className={styles.pricingFeature}>See current plan state</li>
            </ul>
          </div>
          <div className={`${styles.pricingCard} ${styles.pricingFeatured}`}>
            <h3 className={styles.pricingName}>2. Open SDK Showcase</h3>
            <div className={styles.pricingPrice}>Try<span className={styles.pricingPer}> live APIs</span></div>
            <ul className={styles.pricingFeatures}>
              <li className={styles.pricingFeature}>React hooks and embed</li>
              <li className={styles.pricingFeature}>Node client methods</li>
              <li className={styles.pricingFeature}>Webhook and event helpers</li>
              <li className={styles.pricingFeature}>Infra service map</li>
            </ul>
          </div>
          <div className={styles.pricingCard}>
            <h3 className={styles.pricingName}>3. Enter Billing Portal</h3>
            <div className={styles.pricingPrice}>View<span className={styles.pricingPer}> end-user UX</span></div>
            <ul className={styles.pricingFeatures}>
              <li className={styles.pricingFeature}>Managed billing portal</li>
              <li className={styles.pricingFeature}>Plan changes</li>
              <li className={styles.pricingFeature}>Invoices and payment state</li>
              <li className={styles.pricingFeature}>Embed-ready UX</li>
            </ul>
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <Link href="/dashboard/sdk" className={styles.btnPrimary}>
            Open the SDK Showcase →
          </Link>
        </div>
      </section>
    </div>
  );
}
