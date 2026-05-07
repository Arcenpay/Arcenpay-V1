"use client";

import { useEffect, useRef, useState } from "react";
import { useArcenPay } from "@arcenpay/react";

type UseDemoArcenSessionOptions = {
  companyName?: string;
  userName?: string;
};

export function useDemoArcenSession(
  address?: string | null,
  options?: UseDemoArcenSessionOptions,
) {
  const { identify, session } = useArcenPay();
  const identifiedWalletRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const normalizedAddress = address?.toLowerCase() ?? null;
  const identified =
    !!normalizedAddress &&
    !!session.token &&
    session.company?.wallet?.toLowerCase() === normalizedAddress;

  useEffect(() => {
    if (!normalizedAddress) {
      identifiedWalletRef.current = null;
      setStatus("idle");
      setError(null);
      return;
    }

    if (identified) {
      identifiedWalletRef.current = normalizedAddress;
      setStatus("ready");
      setError(null);
      return;
    }

    if (identifiedWalletRef.current === normalizedAddress) return;

    let cancelled = false;
    setStatus("loading");
    setError(null);

    void identify({
      company: {
        id: `company-${normalizedAddress.slice(2, 10)}`,
        wallet: address ?? normalizedAddress,
        name: options?.companyName ?? "ArcenPay Demo Studio",
      },
      user: {
        id: `user-${normalizedAddress.slice(2, 10)}`,
        wallet: address ?? normalizedAddress,
        name: options?.userName ?? "Demo User",
      },
    })
      .then(() => {
        if (cancelled) return;
        identifiedWalletRef.current = normalizedAddress;
        setStatus("ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        setStatus("error");
        setError(
          cause instanceof Error
            ? cause.message
            : "Failed to identify demo company",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    address,
    identify,
    identified,
    normalizedAddress,
    options?.companyName,
    options?.userName,
  ]);

  return {
    identified,
    loading: status === "loading",
    status,
    error,
    session,
  };
}
