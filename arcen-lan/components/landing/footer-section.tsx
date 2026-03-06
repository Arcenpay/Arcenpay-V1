"use client";

import { Github, Twitter } from "lucide-react";
import { Terminal } from "lucide-react";

const footerLinks = {
  Protocol: [
    { name: "Features", href: "#features" },
    { name: "Architecture", href: "#how-it-works" },
    { name: "Metrics", href: "#metrics" },
    { name: "Roadmap", href: "#" },
  ],
  Developers: [
    { name: "Documentation", href: "#" },
    { name: "SDK Reference", href: "#" },
    { name: "Smart Contracts", href: "#developers" },
    { name: "Status", href: "#" },
  ],
  Resources: [
    { name: "Whitepaper", href: "#" },
    { name: "Blog", href: "#" },
    { name: "Community", href: "#" },
    { name: "Brand Kit", href: "#" },
  ],
  Legal: [
    { name: "Privacy", href: "#" },
    { name: "Terms", href: "#" },
    { name: "Security", href: "#" },
  ],
};

export function FooterSection() {
  return (
    <footer className="relative border-t border-border">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Main Footer */}
        <div className="py-16">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-8">
            {/* Brand Column */}
            <div className="col-span-2">
              {/* Logo */}
              <a href="#" className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <span className="font-mono text-primary font-bold text-sm">A</span>
                </div>
                <span className="font-semibold text-lg tracking-tight">ArcenPay</span>
              </a>

              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                The decentralized billing and access control protocol for Web3.
                MEAP + ZKVUB — automated subscriptions meets verifiable usage billing.
              </p>

              {/* Social Links */}
              <div className="flex gap-3">
                <a
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Twitter"
                >
                  <Twitter className="w-5 h-5" />
                </a>
                <a
                  href="#"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="GitHub"
                >
                  <Github className="w-5 h-5" />
                </a>
              </div>
            </div>

            {/* Link Columns */}
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h3 className="text-sm font-medium mb-4">{title}</h3>
                <ul className="space-y-3">
                  {links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="py-6 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © 2026 ArcenPay. All rights reserved.
          </p>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              All contracts operational
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
