"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { useRouter } from "next/navigation";
import { isPlatformAdminEmail } from "@/lib/admin";

export type ActivationStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "UNACTIVATED";

interface ActivationContextValue {
  isLoading: boolean;
  isReadOnly: boolean;
  status: ActivationStatus;
  isModalOpen: boolean;
  promptReason: string | null;
  openModal: (reason?: string) => void;
  closeModal: () => void;
  guardAction: (action: () => void, reason?: string) => void;
  refreshActivation: () => Promise<void>;
}

const ActivationContext = createContext<ActivationContextValue | null>(null);

export function ActivationProvider({ children }: { children: React.ReactNode }) {
  const { data: session, isLoading, refresh } = useDashboardSession();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [promptReason, setPromptReason] = useState<string | null>(null);
  const router = useRouter();

  // Platform administrators are ALWAYS unlocked without restrictions
  const isPlatformAdmin =
    session?.user?.isPlatformAdmin === true ||
    isPlatformAdminEmail(session?.user?.email);

  // Check if team is activated
  const isTeamActivated = session?.currentTeam?.isPlatformActivated === true;

  // IMPORTANT: While loading, NEVER treat as read-only to avoid jarring flash of banner on reload!
  const isReadOnly = !isLoading && !isPlatformAdmin && !isTeamActivated;

  const rawStatus = session?.currentTeam?.activationKeyStatus;
  const status: ActivationStatus = isLoading
    ? "ACTIVE"
    : isPlatformAdmin
    ? "ACTIVE"
    : rawStatus
    ? (rawStatus as ActivationStatus)
    : isTeamActivated
    ? "ACTIVE"
    : "UNACTIVATED";

  const openModal = useCallback((reason?: string) => {
    setPromptReason(reason || null);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setPromptReason(null);
  }, []);

  const guardAction = useCallback(
    (action: () => void, reason?: string) => {
      if (!isReadOnly) {
        action();
        return;
      }
      openModal(reason || "An activation key is required to perform this action.");
    },
    [isReadOnly, openModal]
  );

  const refreshActivation = useCallback(async () => {
    await refresh();
    router.refresh();
  }, [refresh, router]);

  // Global capture for write/mutation clicks when in read-only mode
  useEffect(() => {
    if (!isReadOnly) return;

    const handleCaptureClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Allow navigation, modals, search, tabs, filters, dismiss buttons
      if (
        target.closest("[data-readonly-allowed]") ||
        target.closest("[data-state='active']") ||
        target.closest("nav") ||
        target.closest("[data-sidebar]") ||
        target.closest("[role='tab']") ||
        target.closest("[data-dismiss]") ||
        target.closest(".activation-modal-content") ||
        target.closest("#activation-read-only-banner") ||
        target.closest("[data-radix-collection-item]")
      ) {
        return;
      }

      // Check if clicking a mutating button, submit button, or element with data-write
      const writeButton = target.closest(
        "button[type='submit'], [data-write], [data-mutation], button.btn-create, button.btn-new, button.btn-delete"
      );

      // Also detect buttons with write keywords
      const buttonEl = target.closest("button");
      let isWriteIntent = !!writeButton;

      if (buttonEl && !isWriteIntent) {
        const text = (buttonEl.textContent || "").trim().toLowerCase();
        const writeKeywords = [
          "new plan",
          "create plan",
          "add-on",
          "add credit",
          "create feature",
          "new feature",
          "add endpoint",
          "create api key",
          "generate secret",
          "save changes",
          "save profile",
          "invite member",
          "add member",
          "delete",
          "revoke key",
          "change plan",
          "cancel subscription",
        ];
        if (writeKeywords.some((kw) => text.includes(kw))) {
          isWriteIntent = true;
        }
      }

      if (isWriteIntent) {
        e.preventDefault();
        e.stopPropagation();
        const actionLabel = buttonEl ? buttonEl.textContent?.trim() : "this action";
        openModal(`Enter an activation key to ${actionLabel ? `perform "${actionLabel}"` : "modify workspace settings"}.`);
      }
    };

    window.addEventListener("click", handleCaptureClick, true);
    return () => {
      window.removeEventListener("click", handleCaptureClick, true);
    };
  }, [isReadOnly, openModal]);

  return (
    <ActivationContext.Provider
      value={{
        isLoading,
        isReadOnly,
        status,
        isModalOpen,
        promptReason,
        openModal,
        closeModal,
        guardAction,
        refreshActivation,
      }}
    >
      {children}
    </ActivationContext.Provider>
  );
}

export function useActivationGuard() {
  const ctx = useContext(ActivationContext);
  if (!ctx) {
    return {
      isLoading: false,
      isReadOnly: false,
      status: "ACTIVE" as ActivationStatus,
      isModalOpen: false,
      promptReason: null,
      openModal: () => {},
      closeModal: () => {},
      guardAction: (action: () => void) => action(),
      refreshActivation: async () => {},
    };
  }
  return ctx;
}
