/**
 * Developer diagnostics for entitlement/flag lookups.
 *
 * Feature keys are matched EXACTLY. A one-character typo therefore resolves to
 * `enabled: false` with no error, no warning and no failed request — it is
 * indistinguishable from a legitimate "your plan does not include this".
 * Integrating teams have lost real time to this (`ai_summery` vs `ai_summary`),
 * and the defensive workaround people reach for is nonsense:
 *
 *   const isEntitled = Boolean(useFlag("ai_summery") || useFlag("ai_summary"));
 *
 * The API already tells us when a key is unknown — it returns
 * `reason: "Flag not found"` — so we surface that in development.
 *
 * Production is silent: a console warning is noise for end users, and the
 * response shape is unchanged for everyone.
 */

/** Reason string the backend returns for a key it has no record of. */
export const UNKNOWN_FEATURE_KEY_REASON = "Flag not found";

/** Warn once per key per session, so render churn cannot spam the console. */
const warnedKeys = new Set<string>();

export function warnOnUnknownFeatureKey(
  featureKey: string,
  reason: string | null | undefined,
): void {
  if (process.env.NODE_ENV === "production") return;
  if (reason !== UNKNOWN_FEATURE_KEY_REASON) return;
  if (warnedKeys.has(featureKey)) return;
  warnedKeys.add(featureKey);

  console.warn(
    `[ArcenPay] Unknown feature key "${featureKey}" — the API returned ` +
      `"${UNKNOWN_FEATURE_KEY_REASON}", so this resolves to false on every ` +
      "check. Feature keys are matched EXACTLY, so this is usually a typo " +
      '(e.g. "ai_summery" vs "ai_summary"). Confirm the key in the ArcenPay ' +
      "dashboard under Features / Entitlements.",
  );
}

/** Test seam: clears the once-per-key warning latch. */
export function resetUnknownFeatureKeyWarnings(): void {
  warnedKeys.clear();
}
