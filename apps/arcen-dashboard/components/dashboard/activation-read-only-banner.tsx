"use client";

import { useActivationGuard } from "@/contexts/activation-context";
import { KeyRound, ShieldAlert, Clock, Lock, ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ActivationReadOnlyBanner() {
  const { isReadOnly, isLoading, status, openModal } = useActivationGuard();

  if (isLoading || !isReadOnly) return null;

  const isExpired = status === "EXPIRED";
  const isRevoked = status === "REVOKED";

  const getStatusConfig = () => {
    if (isRevoked) {
      return {
        badge: "REVOKED LICENSE",
        badgeClass: "bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30",
        title: "Platform License Revoked — Read-Only Mode",
        desc: "This workspace's activation key has been revoked. All writes, feature creations, and billing updates are locked.",
        buttonText: "Enter Replacement Key",
        icon: ShieldAlert,
        iconColor: "text-red-600 dark:text-red-400",
        containerClass: "bg-red-500/5 border-red-500/20 text-red-950 dark:text-red-200",
      };
    }
    if (isExpired) {
      return {
        badge: "EXPIRED LICENSE",
        badgeClass: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30",
        title: "Platform License Expired — Read-Only Mode",
        desc: "Your platform activation key has expired. Browsing is enabled, but modifications require an updated activation key.",
        buttonText: "Renew Activation Key",
        icon: Clock,
        iconColor: "text-amber-600 dark:text-amber-400",
        containerClass: "bg-amber-500/5 border-amber-500/20 text-amber-950 dark:text-amber-200",
      };
    }
    return {
      badge: "READ-ONLY",
      badgeClass: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
      title: "Workspace in Read-Only Mode",
      desc: "An active platform activation key is required to create plans, modify webhooks, or perform billing operations.",
      buttonText: "Activate Workspace",
      icon: Lock,
      iconColor: "text-blue-600 dark:text-blue-400",
      containerClass: "bg-blue-50/50 border-blue-200 text-blue-950 dark:bg-blue-950/20 dark:border-blue-900/40 dark:text-blue-200",
    };
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div
      id="activation-read-only-banner"
      className={`border-b px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs transition-all ${config.containerClass}`}
      data-readonly-allowed="true"
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <Icon className={`w-4 h-4 shrink-0 ${config.iconColor}`} />
        <span className={`px-2 py-0.5 rounded-full font-semibold text-[10px] tracking-wider border shrink-0 ${config.badgeClass}`}>
          {config.badge}
        </span>
        <span className="font-medium text-xs truncate">
          <strong>{config.title}:</strong> {config.desc}
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <a
          href="https://www.arcenpay.com/contact"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] underline opacity-80 hover:opacity-100 inline-flex items-center gap-1 transition-opacity"
          data-readonly-allowed="true"
        >
          Need a key? Contact Us <ExternalLink className="w-2.5 h-2.5" />
        </a>
        <Button
          size="sm"
          onClick={() => openModal()}
          className="h-7 px-2.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shadow-none"
          data-readonly-allowed="true"
        >
          <KeyRound className="w-3.5 h-3.5" />
          {config.buttonText}
        </Button>
      </div>
    </div>
  );
}
