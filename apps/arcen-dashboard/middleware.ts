import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/login(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  "/onboarding/wallet(.*)",
  "/api/auth/nonce(.*)",
  "/api/auth/link-wallet(.*)",
  "/api/auth/wallet-status(.*)",
  "/api/webhooks/clerk(.*)",
  // Catalog APIs handle auth/permission checks themselves and should return JSON
  // 401/403 errors instead of Clerk's dev 404 rewrite.
  "/api/catalog/(.*)",
  "/api/entitlements/(.*)",
  // External v1 API — uses API key auth, not Clerk session auth
  "/api/v1/(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
