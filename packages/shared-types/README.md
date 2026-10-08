# @arcenpay/shared-types

Shared TypeScript contracts between the ArcenPay backend and the provider dashboard.

This package contains the API envelopes and DTO shapes (requests, responses, and
error codes) that both sides of the wire compile against, so a change to a payload
shape is a single, type-checked edit rather than an out-of-band agreement.

```ts
import type { ApiEnvelope, PlanSummary } from "@arcenpay/shared-types";
```

## Scripts

```bash
npm run build --workspace=@arcenpay/shared-types      # tsc
npm run typecheck --workspace=@arcenpay/shared-types  # tsc --noEmit
```

Private package — not published to npm.
