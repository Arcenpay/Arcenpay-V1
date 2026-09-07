"use client";

import { useState, useEffect } from "react";
import { useActivationGuard } from "@/contexts/activation-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  KeyRound,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
  Lock,
  ArrowRight,
  ShieldAlert,
  Clock,
  LogOut,
  ExternalLink,
  HelpCircle,
} from "lucide-react";
import { toast } from "sonner";

interface KeyVerification {
  valid: boolean;
  reason?: string;
  key?: {
    id: string;
    key: string;
    name: string;
    tier: "FREE" | "PLUS" | "PRO";
    allowPlatformBilling: boolean;
    maxUses: number;
    usedCount: number;
  };
}

export function ActivationModal() {
  const { isModalOpen, closeModal, promptReason, status, refreshActivation } = useActivationGuard();
  const [keyCode, setKeyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [verification, setVerification] = useState<KeyVerification | null>(null);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    window.location.href = "/login";
  };

  // Reset state on modal open/close
  useEffect(() => {
    if (!isModalOpen) {
      setKeyCode("");
      setVerification(null);
      setVerifying(false);
      setRedeeming(false);
    }
  }, [isModalOpen]);

  // Auto-format key with hyphens: ARCN-XXXX-XXXX-XXXX
  const handleKeyChange = (val: string) => {
    let clean = val.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!clean.startsWith("ARCN") && clean.length > 0) {
      if ("ARCN".startsWith(clean)) {
        // user typing prefix
      } else {
        clean = "ARCN" + clean;
      }
    }

    const parts: string[] = [];
    if (clean.length > 0) parts.push(clean.slice(0, 4));
    if (clean.length > 4) parts.push(clean.slice(4, 8));
    if (clean.length > 8) parts.push(clean.slice(8, 12));
    if (clean.length > 12) parts.push(clean.slice(12, 16));

    const formatted = parts.join("-");
    setKeyCode(formatted);
    setVerification(null);
  };

  // Pre-flight check key when complete (19 chars: ARCN-XXXX-XXXX-XXXX)
  useEffect(() => {
    if (keyCode.length === 19) {
      void verifyKey(keyCode);
    }
  }, [keyCode]);

  const verifyKey = async (keyToVerify: string) => {
    setVerifying(true);
    try {
      const res = await fetch("/api/activation/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyToVerify }),
      });
      const data = await res.json();
      if (data.ok && data.valid && data.key) {
        setVerification(data);
      } else {
        setVerification({ valid: false, reason: data.reason || data.error });
      }
    } catch {
      setVerification({ valid: false, reason: "Unable to verify key with server" });
    } finally {
      setVerifying(false);
    }
  };

  const handleActivate = async () => {
    if (!keyCode.trim()) {
      toast.error("Please enter a valid activation key");
      return;
    }

    setRedeeming(true);
    try {
      const res = await fetch("/api/activation/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyCode.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        const grantedTier =
          data.data?.activationKey?.tier || data.data?.team?.platformTier || "Platform";
        toast.success(`Workspace unlocked! Granted ${grantedTier} license.`);
        closeModal();
        await refreshActivation();
      } else {
        toast.error(data.error || "Failed to redeem activation key");
        if (data.reason) {
          setVerification({ valid: false, reason: data.reason });
        }
      }
    } catch {
      toast.error("Network error during activation");
    } finally {
      setRedeeming(false);
    }
  };

  const tierLabels: Record<string, string> = {
    FREE: "Starter",
    PLUS: "Growth (Plus)",
    PRO: "Enterprise (Pro)",
  };

  const isExpired = status === "EXPIRED";
  const isRevoked = status === "REVOKED";

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-md activation-modal-content" data-readonly-allowed="true">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2">
            {isRevoked ? (
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-600 dark:text-red-400">
                <ShieldAlert className="w-4 h-4" />
              </div>
            ) : isExpired ? (
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <Clock className="w-4 h-4" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <KeyRound className="w-4 h-4" />
              </div>
            )}
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {isRevoked
                ? "Unlock Workspace (License Revoked)"
                : isExpired
                ? "Renew Workspace (License Expired)"
                : "Unlock Workspace"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {promptReason ? (
              <span className="block p-2 rounded-md bg-secondary/80 border border-border text-foreground font-medium mb-1">
                {promptReason}
              </span>
            ) : null}
            Enter a platform activation key to unlock modifications, resource creation, and platform billing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Activation Key Code</span>
              {verifying && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground lowercase normal-case">
                  <Loader2 className="w-3 h-3 animate-spin" /> verifying...
                </span>
              )}
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                value={keyCode}
                onChange={(e) => handleKeyChange(e.target.value)}
                placeholder="ARCN-XXXX-XXXX-XXXX"
                className="pl-9 font-mono tracking-wider uppercase text-sm h-10"
                maxLength={19}
                data-readonly-allowed="true"
                autoFocus
              />
            </div>
          </div>

          {/* Verification Status Feedback */}
          {verification && (
            <div
              className={`p-3 rounded-lg border text-xs transition-all ${
                verification.valid
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-900 dark:text-emerald-300"
                  : "border-red-500/30 bg-red-500/5 text-red-900 dark:text-red-300"
              }`}
            >
              {verification.valid && verification.key ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Valid: {verification.key.name}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1.5 border-t border-emerald-500/20">
                    <div>
                      <span className="text-muted-foreground">Tier: </span>
                      <Badge variant="outline" className="font-semibold text-[10px] ml-1">
                        {tierLabels[verification.key.tier] || verification.key.tier}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Billing: </span>
                      <span className="font-semibold">
                        {verification.key.allowPlatformBilling ? "Self-Serve" : "Managed"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">Activation Key Invalid</span>
                        <p className="text-[11px] mt-0.5 opacity-90">
                          {verification.reason === "KEY_NOT_FOUND" && "Key code not recognized. Check for typos."}
                          {verification.reason === "KEY_REVOKED" && "This activation key has been revoked."}
                          {verification.reason === "KEY_EXPIRED" && "This activation key has expired."}
                          {verification.reason === "KEY_EXHAUSTED" && "This key has reached its redemption limit."}
                          {!["KEY_NOT_FOUND", "KEY_REVOKED", "KEY_EXPIRED", "KEY_EXHAUSTED"].includes(
                            verification.reason || ""
                          ) && (verification.reason || "Unable to verify key.")}
                        </p>
                      </div>
                    </div>
                    <div className="text-[11px] pt-1.5 border-t border-red-500/20">
                      <span>Need a replacement key? </span>
                      <a
                        href="https://www.arcenpay.com/contact"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold underline hover:text-red-950 dark:hover:text-red-100 inline-flex items-center gap-1"
                        data-readonly-allowed="true"
                      >
                        Contact Support <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between items-center pt-2 border-t">
          <div className="flex items-center gap-2.5 order-2 sm:order-1">
            <a
              href="https://www.arcenpay.com/contact"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-muted-foreground hover:underline inline-flex items-center gap-1"
              data-readonly-allowed="true"
            >
              Need a key? Contact Us <ExternalLink className="w-3 h-3" />
            </a>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              disabled={loggingOut}
              className="text-xs h-7 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1"
              data-readonly-allowed="true"
            >
              {loggingOut ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
              <span>Log Out</span>
            </Button>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto order-1 sm:order-2">
            <Button
              variant="outline"
              size="sm"
              onClick={closeModal}
              disabled={redeeming}
              className="text-xs h-9 flex-1 sm:flex-initial"
              data-readonly-allowed="true"
            >
              Close
            </Button>
            <Button
              size="sm"
              onClick={handleActivate}
              disabled={redeeming || !keyCode.trim() || (verification !== null && !verification.valid) || keyCode.length < 19}
              className="text-xs h-9 font-medium bg-blue-600 hover:bg-blue-700 text-white flex-1 sm:flex-initial shadow-none"
              data-readonly-allowed="true"
            >
              {redeeming ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  Unlocking...
                </>
              ) : (
                "Unlock workspace"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
