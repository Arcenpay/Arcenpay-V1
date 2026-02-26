"use client";

import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/ConnectButton";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: "📊" },
  { href: "/plans", label: "Plans", icon: "📋" },
  { href: "/subscribers", label: "Subscribers", icon: "👥" },
  { href: "/features", label: "Feature Flags", icon: "🚀" },
  { href: "/sessions", label: "ZKVUB Sessions", icon: "⚡" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="dashboard-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          ⬡ <span>ArcenPay</span>
        </div>

        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`nav-item ${pathname === item.href ? "active" : ""}`}
          >
            {item.icon} {item.label}
          </a>
        ))}

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <ConnectButton />
          <a
            href="/api/auth/logout"
            className="nav-item"
            style={{ justifyContent: "center", fontSize: 13 }}
          >
            Sign Out
          </a>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
