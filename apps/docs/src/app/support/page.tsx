'use client';

export default function SupportPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Resources</div>
        <div className="docs-page-title-row"><h1>Support</h1></div>

        <p className="docs-lead">
          Get help with your ArcenPay integration from our team and community.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginTop: '40px' }}>
          <div style={{ padding: '24px', borderRadius: '12px', border: '1px solid #f3f4f6', backgroundColor: '#fafafa' }}>
            <h3 style={{ marginTop: 0, fontSize: '18px' }}>GitHub Discussions</h3>
            <p style={{ fontSize: '14px', color: '#6b7280' }}>Best for technical questions, feature requests, and community help.</p>
            <a href="https://github.com/arcenpay/arcenpay/discussions" className="docs-btn" style={{ marginTop: '12px', display: 'inline-block' }}>Visit GitHub</a>
          </div>

          <div style={{ padding: '24px', borderRadius: '12px', border: '1px solid #f3f4f6', backgroundColor: '#fafafa' }}>
            <h3 style={{ marginTop: 0, fontSize: '18px' }}>Discord</h3>
            <p style={{ fontSize: '14px', color: '#6b7280' }}>Join our developer community for real-time support and announcements.</p>
            <a href="https://discord.gg/arcenpay" className="docs-btn" style={{ marginTop: '12px', display: 'inline-block' }}>Join Discord</a>
          </div>

          <div style={{ padding: '24px', borderRadius: '12px', border: '1px solid #f3f4f6', backgroundColor: '#fafafa' }}>
            <h3 style={{ marginTop: 0, fontSize: '18px' }}>Enterprise Support</h3>
            <p style={{ fontSize: '14px', color: '#6b7280' }}>Dedicated engineering support and custom integration consulting.</p>
            <a href="mailto:support@arcenpay.com" className="docs-btn" style={{ marginTop: '12px', display: 'inline-block' }}>Contact Sales</a>
          </div>
        </div>

        <h2 id="faq" style={{ marginTop: '64px' }}>Frequently Asked Questions</h2>
        <div className="docs-faq-item" style={{ marginBottom: '32px' }}>
          <h4 style={{ marginBottom: '8px' }}>Is ArcenPay audited?</h4>
          <p style={{ color: '#4b5563', fontSize: '15px' }}>Yes, our core protocol (PlanFactory and SubscriptionRegistry) was audited by Trail of Bits in Feb 2024.</p>
        </div>
        <div className="docs-faq-item" style={{ marginBottom: '32px' }}>
          <h4 style={{ marginBottom: '8px' }}>Which chains are supported?</h4>
          <p style={{ color: '#4b5563', fontSize: '15px' }}>We currently support Ethereum, Polygon, Arbitrum, Base, and Optimism. Our testnet is live on Sepolia.</p>
        </div>
        <div className="docs-faq-item" style={{ marginBottom: '32px' }}>
          <h4 style={{ marginBottom: '8px' }}>How do you handle gas?</h4>
          <p style={{ color: '#4b5563', fontSize: '15px' }}>Users can pay gas in ETH, or use our Paymaster integration to pay in USDC if they have an ERC-7579 smart account.</p>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#channels">Channels</a></li>
          <li className="docs-toc-item"><a href="#faq">FAQ</a></li>
        </ul>
      </nav>
    </div>
  );
}
