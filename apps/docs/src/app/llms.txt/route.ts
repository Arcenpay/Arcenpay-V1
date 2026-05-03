import { NextResponse } from "next/server";

const LLMS_CONTENT = `# ArcenPay Docs

> Developer documentation for integrating ArcenPay subscriptions, hosted payments, invoices, and SDKs. Built for AI agents and humans alike.

## Start Here
- Introduction: https://docs.arcenpay.xyz
- Base Sepolia Quickstart: https://docs.arcenpay.xyz/quickstart
- Checkout Patterns: https://docs.arcenpay.xyz/features/checkout
- Webhooks: https://docs.arcenpay.xyz/webhooks

## Billing Models
- Plans: https://docs.arcenpay.xyz/core-concepts/plans
- Subscriptions: https://docs.arcenpay.xyz/core-concepts/subscriptions
- Feature Flags: https://docs.arcenpay.xyz/core-concepts/feature-flags

## SDKs and Frameworks
- SDK Overview: https://docs.arcenpay.xyz/sdk-reference
- React SDK: https://docs.arcenpay.xyz/sdk-reference/react
- Node.js SDK: https://docs.arcenpay.xyz/sdk-reference/node
- Next.js Integration: https://docs.arcenpay.xyz/frameworks/nextjs
- Express Integration: https://docs.arcenpay.xyz/frameworks/express

## API Reference
- Authentication: https://docs.arcenpay.xyz/api-reference/auth
- Plans API: https://docs.arcenpay.xyz/api-reference/plans
- Subscriptions API: https://docs.arcenpay.xyz/api-reference/subscriptions
- Errors API: https://docs.arcenpay.xyz/api-reference/errors

## Guides
- SaaS Subscription Wall: https://docs.arcenpay.xyz/guides/subscription-wall
- Feature Gating: https://docs.arcenpay.xyz/guides/feature-gating
- Migrate from Stripe: https://docs.arcenpay.xyz/guides/migrate-from-stripe

## Resources
- Changelog: https://docs.arcenpay.xyz/changelog
- Support: https://docs.arcenpay.xyz/support
`;

export async function GET() {
  return new NextResponse(LLMS_CONTENT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Signal": "ai-train=yes, search=yes, ai-input=yes",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
