import Link from "next/link";
import styles from "./page.module.css";

export default function LandingPage() {
  return (
    <div className={styles.root}>
      {/* Nav */}
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <span className={styles.navLogo}>⬡</span>
          <span className={styles.navName}>ScanBot</span>
          <span className={styles.navBadge}>Demo</span>
        </div>
        <div className={styles.navLinks}>
          <Link href="/dashboard" className={styles.navLink}>
            Dashboard
          </Link>
          <Link href="/dashboard/billing" className={styles.btnPrimary}>
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroEyebrow}>Powered by ArcenPay</div>
        <h1 className={styles.heroTitle}>
          AI Document Scanning
          <br />
          <span className={styles.heroAccent}>Built for Web3</span>
        </h1>
        <p className={styles.heroSub}>
          Scan, extract, and verify documents with AI. Pay with crypto.
          <br />
          Usage tracked on-chain. Plans enforced trustlessly.
        </p>
        <div className={styles.heroCta}>
          <Link href="/dashboard" className={styles.btnPrimary}>
            Open App
          </Link>
          <Link href="/dashboard/billing" className={styles.btnSecondary}>
            View Plans
          </Link>
        </div>
      </section>

      {/* Feature grid */}
      <section className={styles.features}>
        <h2 className={styles.sectionTitle}>Everything you need</h2>
        <div className={styles.featureGrid}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <div className={styles.featureIcon}>{f.icon}</div>
              <h3 className={styles.featureTitle}>{f.title}</h3>
              <p className={styles.featureDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing section */}
      <section className={styles.pricing}>
        <h2 className={styles.sectionTitle}>Simple pricing</h2>
        <p className={styles.sectionSub}>
          Plans are enforced on-chain via ArcenPay smart contracts.
          <br />
          Your usage is ZK-proven — no trusting our servers.
        </p>
        <div className={styles.pricingGrid}>
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`${styles.pricingCard} ${plan.featured ? styles.pricingFeatured : ""}`}
            >
              {plan.featured && (
                <div className={styles.pricingBadge}>Most Popular</div>
              )}
              <div className={styles.pricingName}>{plan.name}</div>
              <div className={styles.pricingPrice}>
                {plan.price === 0 ? (
                  "Free"
                ) : (
                  <>
                    <span className={styles.pricingAmount}>${plan.price}</span>
                    <span className={styles.pricingPer}>/mo</span>
                  </>
                )}
              </div>
              <ul className={styles.pricingFeatures}>
                {plan.features.map((f) => (
                  <li key={f} className={styles.pricingFeature}>
                    <span className={styles.checkIcon}>✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard/billing"
                className={
                  plan.featured ? styles.btnPrimary : styles.btnSecondary
                }
              >
                {plan.price === 0 ? "Start Free" : "Get Started"}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ArcenPay callout */}
      <section className={styles.callout}>
        <div className={styles.calloutContent}>
          <div className={styles.calloutIcon}>⬡</div>
          <h2 className={styles.calloutTitle}>
            Powered by ArcenPay Protocol
          </h2>
          <p className={styles.calloutDesc}>
            ArcenPay is the Web3-native subscription protocol. Feature flags,
            entitlements, and usage billing — all enforced on-chain with ZK
            proofs.
          </p>
          <div className={styles.calloutLinks}>
            <a
              href="http://localhost:3000"
              className={styles.btnPrimary}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Dashboard
            </a>
            <Link href="/dashboard" className={styles.btnSecondary}>
              See Integration
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <span className={styles.footerBrand}>
          <span>⬡</span> ScanBot
        </span>
        <span className={styles.footerSub}>
          Demo app — built with{" "}
          <a href="http://localhost:3000" className={styles.footerLink}>
            ArcenPay
          </a>
        </span>
      </footer>
    </div>
  );
}

const FEATURES = [
  {
    icon: "◈",
    title: "On-chain Plans",
    desc: "Your subscription is a smart contract. No middleman, no chargebacks.",
  },
  {
    icon: "⬡",
    title: "ZK Usage Proofs",
    desc: "Usage is proven with zero-knowledge circuits. Cryptographic billing.",
  },
  {
    icon: "◉",
    title: "Feature Flags",
    desc: "Features toggled on/off based on your plan. Evaluated server-side with ArcenPay.",
  },
  {
    icon: "◆",
    title: "Custom Components",
    desc: "Build your billing portal in the ArcenPay dashboard. Drop in <ArcenEmbed />.",
  },
  {
    icon: "◇",
    title: "Credit System",
    desc: "Buy scan credits, roll them over, set auto top-up — all on-chain.",
  },
  {
    icon: "◎",
    title: "Wallet Identity",
    desc: "No email required. Your wallet is your identity across the protocol.",
  },
];

const PLANS = [
  {
    name: "Free",
    price: 0,
    featured: false,
    features: ["50 scans / month", "Basic extraction", "PDF export", "Community support"],
  },
  {
    name: "Pro",
    price: 29,
    featured: true,
    features: [
      "500 scans / month",
      "AI extraction",
      "PDF + CSV export",
      "API access",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    price: 149,
    featured: false,
    features: [
      "Unlimited scans",
      "Advanced AI models",
      "All export formats",
      "Dedicated API",
      "SLA + support",
    ],
  },
];
