"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Refreshes the current page after `intervalMs` milliseconds.
 * Used by the dashboard layout's workspace-pending state so the server
 * re-checks team membership without the user having to reload manually.
 */
export default function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setTimeout(() => router.refresh(), intervalMs);
    return () => clearTimeout(id);
  }, [router, intervalMs]);

  return null;
}
