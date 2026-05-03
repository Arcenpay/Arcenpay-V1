"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Moon, Sun, Search, Menu, X, ExternalLink, ChevronDown } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import DocsPageBehavior from "./DocsPageBehavior";
import { DOCS_NAV_GROUPS, TOP_LEVEL_DOCS_LINKS } from "@/lib/docs-nav";

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3000";

function isItemActive(pathname: string, href: string) {
  return pathname === href.split("#")[0];
}

function isGroupItemMatch(pathname: string, href: string) {
  const cleanHref = href.split("#")[0];
  if (cleanHref === "/") return pathname === "/";
  return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

function prettifyPathname(pathname: string) {
  if (pathname === "/") return "Introduction";
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((s) =>
      s
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
    );
  return segments.join(" / ");
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-inherit rounded-sm px-0.5 -mx-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function Sidebar({
  pathname,
  open,
  onClose,
}: {
  pathname: string;
  open: boolean;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!q) return DOCS_NAV_GROUPS;
    return DOCS_NAV_GROUPS
      .map((group) => {
        if (group.label.toLowerCase().includes(q)) return group;
        return {
          ...group,
          items: group.items.filter((item) =>
            `${item.label} ${item.description ?? ""}`.toLowerCase().includes(q),
          ),
        };
      })
      .filter((group) => group.items.length > 0);
  }, [q]);

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const hasResults = filteredGroups.length > 0;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-label="Close navigation"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[284px] max-w-[85vw] border-r border-sidebar-border bg-sidebar flex flex-col
          transition-transform duration-200 lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand */}
        <div className="border-b border-sidebar-border px-4 py-4 bg-sidebar/95 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="size-7 rounded-lg overflow-hidden shrink-0 block" onClick={onClose}>
              <svg width="28" height="28" viewBox="0 0 512 512" fill="none">
                <rect width="512" height="512" fill="#0f3ea8" rx="100" />
                <polygon points="214,142 284,142 414,414 344,414" fill="#fff" />
                <circle cx="230" cy="265" r="45" fill="#5c84db" />
                <circle cx="170" cy="350" r="50" fill="#fff" />
              </svg>
            </Link>
            <span className="text-[13px] font-semibold tracking-tight text-sidebar-foreground">
              ArcenPay Docs
            </span>
            <Badge
              variant="outline"
              className="ml-auto text-[10px] px-2 py-1 rounded-full border-sidebar-border text-primary"
            >
              Public
            </Badge>
            <button
              className="lg:hidden ml-1 size-6 rounded-lg border border-sidebar-border bg-sidebar text-muted-foreground text-lg leading-none flex items-center justify-center shrink-0"
              onClick={onClose}
              aria-label="Close navigation"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="mt-3 relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search docs..."
              className="w-full h-9 rounded-xl border border-sidebar-border bg-muted/60 pl-9 pr-8 text-[13px]
                text-sidebar-foreground outline-none placeholder:text-muted-foreground
                focus:border-sidebar-ring/30 focus:ring-[3px] focus:ring-sidebar-ring/10 transition-all"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-3 py-3.5 space-y-1.5">
          {!hasResults && q && (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">No results for &ldquo;{q}&rdquo;</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Try a different search term.
              </p>
            </div>
          )}

          {filteredGroups.map((group) => {
            const isCollapsed = collapsed[group.id] ?? (q ? false : false);
            const hasActive = group.items.some((item) =>
              isGroupItemMatch(pathname, item.href),
            );

            return (
              <div key={group.id}>
                <button
                  onClick={() => toggleGroup(group.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-semibold uppercase
                    tracking-wider transition-colors
                    ${hasActive ? "text-primary" : "text-muted-foreground hover:text-sidebar-foreground"}`}
                >
                  <span>{highlightMatch(group.label, q)}</span>
                  <ChevronDown
                    className={`size-3 transition-transform duration-200 ${
                      isCollapsed ? "-rotate-90" : ""
                    }`}
                  />
                </button>

                {!isCollapsed && (
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    {group.items.map((item) => {
                      const active = isItemActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={onClose}
                          target={item.external ? "_blank" : undefined}
                          rel={item.external ? "noreferrer" : undefined}
                          className={`block px-2.5 py-2 rounded-xl text-[13.5px] leading-relaxed relative transition-colors
                            ${
                              active
                                ? "text-sidebar-foreground font-medium bg-accent-soft"
                                : "text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/40"
                            }
                            ${
                              active
                                ? "before:absolute before:left-[-1px] before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-4 before:rounded-r-sm before:bg-primary"
                                : ""
                            }
                          `}
                        >
                          <div className="flex items-center gap-1">
                            <span>{highlightMatch(item.label, q)}</span>
                            {item.external && (
                              <ExternalLink className="size-2.5 ml-auto opacity-40" />
                            )}
                          </div>
                          {item.description && (
                            <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                              {highlightMatch(item.description, q)}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

export default function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { theme, toggle: toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <DocsPageBehavior />
      <Sidebar
        pathname={pathname}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col bg-background">
        {/* Topbar */}
        <header className="sticky top-0 z-20 h-14 border-b border-border bg-background/90 backdrop-blur-md flex items-center gap-3 px-4 lg:px-7">
          <div className="flex items-center gap-2.5 min-w-0">
            <Button
              variant="outline"
              size="icon-sm"
              className="lg:hidden shrink-0"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-4" />
            </Button>
            <div className="min-w-0">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                ArcenPay
              </div>
              <div className="text-sm font-semibold text-foreground truncate">
                {prettifyPathname(pathname)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 ml-auto">
            {TOP_LEVEL_DOCS_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hidden lg:inline-flex items-center px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium
                  text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <a
              href={DASHBOARD_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-foreground text-background hover:bg-foreground/85
                text-xs font-bold px-3 py-2 ml-1.5 transition-colors"
            >
              Open Dashboard
            </a>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
              className="ml-1"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="size-[15px]" />
              ) : (
                <Moon className="size-[15px]" />
              )}
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 min-w-0 flex flex-col">{children}</main>
      </div>
    </div>
  );
}
