"use client";

import type { ArcenIdentifyInput } from "@arcenpay/react";
import { useArcenPay } from "@arcenpay/react";
import { useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useRef } from "react";
import { useAccount } from "wagmi";
import {
  buildReceiptCompanyIdentity,
  buildReceiptUserIdentity,
  getClerkWalletAddress,
  normalizeWalletAddress,
} from "@/lib/receipt-billing";

const IDENTIFY_RETRY_DELAY_MS = 5_000;

export function ArcenIdentitySync() {
  const { user, isLoaded } = useUser();
  const { address, isConnected } = useAccount();
  const { identify, session } = useArcenPay() as {
    identify: (input: ArcenIdentifyInput) => Promise<void>;
    session: {
      token?: string | null;
      company?: { id?: string | null; wallet?: string | null } | null;
      user?: { id?: string | null; clerkUserId?: string | null } | null;
    };
  };
  const inFlightKeyRef = useRef<string | null>(null);
  const lastFailKeyRef = useRef<string | null>(null);
  const lastFailTimeRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionValue = session;

  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const name =
    user?.fullName ??
    user?.username ??
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress ??
    null;
  const linkedWalletAddress = normalizeWalletAddress(getClerkWalletAddress(user));
  const liveWalletAddress = normalizeWalletAddress(isConnected ? address ?? null : null);
  const walletAddress = linkedWalletAddress ?? liveWalletAddress;

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

    const sessionWallet = sessionValue.company?.wallet?.toLowerCase() ?? null;
    const currentWallet = walletAddress?.toLowerCase() ?? null;
    const alreadyIdentified =
      Boolean(sessionValue.token) &&
      (sessionValue.user?.clerkUserId ??
        sessionValue.user?.id ??
        sessionValue.company?.id) ===
        user.id &&
      sessionWallet === currentWallet;

    if (alreadyIdentified || inFlightKeyRef.current === identityKey) {
      return;
    }

    const prevFailed = lastFailKeyRef.current === identityKey;
    const timeSinceFail = Date.now() - lastFailTimeRef.current;

    if (prevFailed && timeSinceFail < IDENTIFY_RETRY_DELAY_MS) {
      if (!retryTimerRef.current) {
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          lastFailKeyRef.current = null;
          inFlightKeyRef.current = null;
        }, IDENTIFY_RETRY_DELAY_MS - timeSinceFail);
      }
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
        lastFailKeyRef.current = identityKey;
        lastFailTimeRef.current = Date.now();
      })
      .finally(() => {
        if (inFlightKeyRef.current === identityKey) {
          inFlightKeyRef.current = null;
        }
      });
  }, [email, identityKey, identify, isConnected, isLoaded, name, sessionValue.company?.id, sessionValue.company?.wallet, sessionValue.token, sessionValue.user?.clerkUserId, sessionValue.user?.id, user, walletAddress]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  return null;
}
