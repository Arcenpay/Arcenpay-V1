"use client";

import { useArcenPay } from "@arcenpay/react";
import { useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useRef } from "react";
import { useAccount } from "wagmi";
import {
  buildReceiptCompanyIdentity,
  buildReceiptUserIdentity,
  getClerkWalletAddress,
} from "@/lib/receipt-billing";

export function ArcenIdentitySync() {
  const { user, isLoaded } = useUser();
  const { address } = useAccount();
  const { identify, session } = useArcenPay();
  const inFlightKeyRef = useRef<string | null>(null);

  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const name =
    user?.fullName ??
    user?.username ??
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress ??
    null;
  const walletAddress = getClerkWalletAddress(user) ?? address ?? null;

  const identityKey = useMemo(() => {
    if (!user) {
      return null;
    }

    return [user.id, walletAddress ?? "no-wallet", email ?? "no-email"].join(":");
  }, [email, user, walletAddress]);

  useEffect(() => {
    if (!isLoaded || !user || !identityKey) {
      inFlightKeyRef.current = null;
      return;
    }

    const sessionWallet = session.company?.wallet?.toLowerCase() ?? null;
    const currentWallet = walletAddress?.toLowerCase() ?? null;
    const alreadyIdentified =
      Boolean(session.token) &&
      (session.user?.clerkUserId ?? session.user?.id ?? session.company?.id) ===
        user.id &&
      sessionWallet === currentWallet;

    if (alreadyIdentified || inFlightKeyRef.current === identityKey) {
      return;
    }

    inFlightKeyRef.current = identityKey;

    void identify({
      company: buildReceiptCompanyIdentity({
        clerkUserId: user.id,
        email,
        name,
        walletAddress,
      }),
      user: buildReceiptUserIdentity({
        clerkUserId: user.id,
        email,
        name,
        walletAddress,
      }),
    })
      .catch((error) => {
        console.error("[receipt-saas] failed to identify billing session", error);
      })
      .finally(() => {
        if (inFlightKeyRef.current === identityKey) {
          inFlightKeyRef.current = null;
        }
      });
  }, [email, identityKey, identify, isLoaded, name, session.company?.id, session.company?.wallet, session.token, session.user?.clerkUserId, session.user?.id, user, walletAddress]);

  return null;
}
