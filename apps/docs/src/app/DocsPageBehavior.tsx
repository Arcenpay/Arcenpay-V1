"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type TocEntry = {
  href: string;
  item: HTMLLIElement;
  link: HTMLAnchorElement;
  target: HTMLElement;
};

const HEADER_OFFSET = 92;

function setActiveEntry(entries: TocEntry[], activeHref: string | null) {
  for (const entry of entries) {
    const isActive = entry.href === activeHref;
    const wasActive = entry.item.classList.contains("active");
    entry.item.classList.toggle("active", isActive);
    if (isActive) {
      entry.link.setAttribute("aria-current", "true");
      if (!wasActive) {
        entry.link.scrollIntoView({ block: "nearest" });
      }
    } else {
      entry.link.removeAttribute("aria-current");
    }
  }
}

function getActiveHref(entries: TocEntry[]) {
  const scrolledBottom =
    window.innerHeight + window.scrollY >= document.body.scrollHeight - 8;

  if (scrolledBottom) {
    return entries.at(-1)?.href ?? null;
  }

  let activeHref = entries[0]?.href ?? null;

  for (const entry of entries) {
    const top = entry.target.getBoundingClientRect().top;
    if (top - HEADER_OFFSET <= 0) {
      activeHref = entry.href;
      continue;
    }

    if (!activeHref) {
      activeHref = entry.href;
    }
    break;
  }

  return activeHref;
}

export default function DocsPageBehavior() {
  const pathname = usePathname();

  useEffect(() => {
    let frame = 0;

    const init = () => {
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(".toc-item a[href^='#']"),
      );

      const entries = links
        .map((link) => {
          const item = link.closest<HTMLLIElement>(".toc-item");
          const href = link.getAttribute("href");
          if (!item || !href) return null;

          const id = href.slice(1);
          const target = id ? document.getElementById(id) : null;
          if (!target) return null;

          return { href, item, link, target };
        })
        .filter((entry): entry is TocEntry => entry !== null);

      if (entries.length === 0) return;

      const sync = () => {
        setActiveEntry(entries, getActiveHref(entries));
      };

      const onScroll = () => {
        cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(sync);
      };

      sync();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      window.addEventListener("hashchange", onScroll);

      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        window.removeEventListener("hashchange", onScroll);
      };
    };

    const cleanup = init();
    return () => {
      cleanup?.();
      cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return null;
}
