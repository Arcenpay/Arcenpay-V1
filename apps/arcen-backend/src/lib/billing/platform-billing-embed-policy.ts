export type PlatformBillingSetupRole = "OWNER" | "ADMIN" | "FINANCE" | "DEVELOPER" | "SUPPORT" | "MEMBER";

/** Platform self-billing is opt-in. Reading the billing page must be side-effect free. */
export function requestedPlatformBillingSetup(body: unknown): boolean {
  return Boolean(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as { initialize?: unknown }).initialize === true,
  );
}

export function canInitializePlatformBilling(role: PlatformBillingSetupRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}
