import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ArcenPay Provider Dashboard',
  description: 'Manage plans, subscribers, feature flags, and analytics for the MEAP Protocol',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="dashboard-layout">
          <aside className="sidebar">
            <div className="sidebar-brand">
              ⬡ <span>ArcenPay</span>
            </div>

            <a href="/" className="nav-item active">
              📊 Overview
            </a>
            <a href="/plans" className="nav-item">
              📋 Plans
            </a>
            <a href="/subscribers" className="nav-item">
              👥 Subscribers
            </a>
            <a href="/features" className="nav-item">
              🚀 Feature Flags
            </a>
            <a href="/sessions" className="nav-item">
              ⚡ ZKVUB Sessions
            </a>
            <a href="/settings" className="nav-item" style={{ marginTop: 'auto' }}>
              ⚙️ Settings
            </a>
          </aside>

          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
