"use client";

import dynamic from "next/dynamic";
import type { EmailAuthFlowProps } from "./email-auth-flow-client";

// Session checks and redirects stay in the server pages. Wallet SDKs and
// interactive authentication are loaded only after browser hydration.
export const EmailAuthFlow = dynamic<EmailAuthFlowProps>(
  () => import("./email-auth-flow-client").then((mod) => mod.EmailAuthFlow),
  { ssr: false },
);
