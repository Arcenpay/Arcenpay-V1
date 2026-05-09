import arcjet, {
  shield,
  detectBot,
  fixedWindow,
  sensitiveInfo,
  tokenBucket,
} from "@arcjet/node";

const isProduction = process.env.NODE_ENV === "production";

const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  characteristics: ["ip.src"],
  rules: isProduction
    ? [
        shield({ mode: "LIVE" }),
        detectBot({
          mode: "LIVE",
          allow: ["CATEGORY:SEARCH_ENGINE", "CATEGORY:MONITOR"],
        }),
      ]
    : [
        shield({ mode: "DRY_RUN" }),
        detectBot({
          mode: "DRY_RUN",
          allow: ["CATEGORY:SEARCH_ENGINE", "CATEGORY:MONITOR"],
        }),
      ],
});

export { shield, detectBot, fixedWindow, sensitiveInfo, tokenBucket };

// ─── Route-specific Arcjet clients ───────────────────────────────────────

/** Generic API protection — shield + bot detection only. */
export { aj };

const rateLimitMode = isProduction ? "LIVE" : "DRY_RUN";

/** Auth nonce: 20 req/min per IP */
export const authNonceProtect = aj.withRule(
  fixedWindow({
    mode: rateLimitMode,
    characteristics: ["ip.src"],
    window: "60s",
    max: 20,
  }),
);

/** Auth email start: 5 req/10min per IP + per email */
export const authEmailStartProtect = aj
  .withRule(
    fixedWindow({
      mode: rateLimitMode,
      characteristics: ["ip.src"],
      window: "10m",
      max: 5,
    }),
  )
  .withRule(
    fixedWindow({
      mode: rateLimitMode,
      characteristics: ["email"],
      window: "10m",
      max: 5,
    }),
  );

/** Auth email verify: 10 attempts per 10 minutes per IP */
export const authEmailVerifyProtect = aj.withRule(
  fixedWindow({
    mode: rateLimitMode,
    characteristics: ["ip.src"],
    window: "10m",
    max: 10,
  }),
);

/** Team invite: 5 req/hour per team */
export const teamInviteProtect = aj.withRule(
  fixedWindow({
    mode: rateLimitMode,
    characteristics: ["teamId"],
    window: "1h",
    max: 5,
  }),
);

/** Invoice resend: 3 req/hour per invoice */
export const invoiceResendProtect = aj.withRule(
  fixedWindow({
    mode: rateLimitMode,
    characteristics: ["invoiceId"],
    window: "1h",
    max: 3,
  }),
);
