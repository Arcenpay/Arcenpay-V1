# ArcenPay — Manual Test Roadmap

Go through each section in order. For each test, mark it as **PASS**, **FAIL**, or **SKIP** and note what you observed. Report back and changes will be made.

---

## Prerequisites

Before starting, make sure:

- [ ] Dashboard is running: `cd apps/arcen-dashboard && pnpm dev`
- [ ] You are signed in with Clerk (Google/email auth)
- [ ] You have created or joined an Organization in Clerk (click org switcher in top bar)
- [ ] A wallet is connected (click "Connect" in the header or "Network" button)

---

## Section 1 — Catalog: Plans

**Goal:** Create a subscription plan, verify it appears on-chain and in the UI.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1.1 | Sidebar → Plans | Plan list loads, no crash | |
| 1.2 | Click "Create Plan" | Sheet opens from right side (not center popup) | |
| 1.3 | Fill: Name, Price, Billing period, select chain | Fields accept input | |
| 1.4 | Submit the form | Plan appears in list within a few seconds | |
| 1.5 | Click a plan row | Detail sheet opens from right with plan info | |
| 1.6 | Try to create duplicate plan name | Error or validation shown | |

**Notes:**
```
[Write your observations here]
```

---

## Section 2 — Catalog: Add-Ons

**Goal:** Create an add-on product.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 2.1 | Sidebar → Add-Ons | List loads without crash | |
| 2.2 | Click "Create Add-On" | Sheet opens from right | |
| 2.3 | Fill name, price, description | Fields work | |
| 2.4 | Submit | Add-on appears in list | |
| 2.5 | Click row to view detail | Detail sheet opens | |

**Notes:**
```
[Write your observations here]
```

---

## Section 3 — Catalog: Credits

**Goal:** Create a credit pack type.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 3.1 | Sidebar → Credits | List loads | |
| 3.2 | Click "Create Credit Pack" | Sheet or form opens | |
| 3.3 | Set name, credit amount, price | Fields work | |
| 3.4 | Submit | Credit pack appears in list | |

**Notes:**
```
[Write your observations here]
```

---

## Section 4 — Catalog: Configuration

**Goal:** Switch environment modes.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 4.1 | Sidebar → Configuration | Page loads with env mode toggle | |
| 4.2 | Toggle PRODUCTION ↔ TEST | Header badge switches Mainnet ↔ Testnet | |
| 4.3 | Sidebar shows correct network label | "Mainnet" or "Testnet" in sidebar status card | |

**Notes:**
```
[Write your observations here]
```

---

## Section 5 — Companies

**Goal:** Create a company, assign a plan, set overrides.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 5.1 | Sidebar → Companies | Table loads (or empty state with button) | |
| 5.2 | Click "Add Company" | Sheet opens from right | |
| 5.3 | Fill: Name (required), Email, Wallet address | Fields work, wallet validates format | |
| 5.4 | Submit | Company appears in table | |
| 5.5 | Click company row | Detail sheet opens with tabs: Entitlements, Users, Overrides, Events | |
| 5.6 | "Entitlements" tab | Shows enabled/disabled feature flags | |
| 5.7 | "Overrides" tab → Add Override | Override for a flag key, set True/False | |
| 5.8 | Verify override shows in list | Override visible with feature key and value | |
| 5.9 | Delete override | Override removed from list | |
| 5.10 | Search companies box | Filters results as you type | |

**Notes:**
```
[Write your observations here]
```

---

## Section 6 — Feature Flags

**Goal:** Create flags, add targeting rules, check evaluation.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 6.1 | Sidebar → Feature Flags | Flag list loads or empty state with CTA | |
| 6.2 | Click "Create Flag" | Sheet opens from right (not center popup) | |
| 6.3 | Fill: Feature Key (snake_case), Name, toggle default value | Key validated, form works | |
| 6.4 | Submit | Flag appears in list with key + name | |
| 6.5 | Click flag row | Detail sheet opens showing rules builder | |
| 6.6 | Click "+ Add Rule" | Rule row added with condition editor | |
| 6.7 | Set condition: company_trait + equals + value | Condition fields update based on type | |
| 6.8 | Set rule value: TRUE | Pill button highlights green | |
| 6.9 | Save rules | Rules persist (visible after refresh) | |
| 6.10 | Toggle flag default value | Changes reflected in UI | |

**Notes:**
```
[Write your observations here]
```

---

## Section 7 — API Keys (in Settings)

**Goal:** Create an API key, use it, revoke it.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 7.1 | Sidebar → Settings → "Protocol Keys" tab | Tab exists and shows key list or empty state | |
| 7.2 | Click "Create API Key" | Sheet opens from right (not center popup) | |
| 7.3 | Fill: Name (required), Description (optional) | Fields work | |
| 7.4 | Submit | Green banner shows the full key (only once) | |
| 7.5 | Copy the key from the banner | Clipboard copy works | |
| 7.6 | Key appears in list with prefix | `api_xxxxx...` badge visible | |
| 7.7 | Hover a row | Delete button appears (opacity transition) | |
| 7.8 | Click delete (trash icon) | Confirmation prompt, then key removed | |

**Notes:**
```
[Write your observations here]
```

---

## Section 8 — SDK E2E Test (automated)

**Goal:** Validate all API endpoints work using the demo test script.

### Setup

1. Create an API key (Section 7 above)
2. Run the test script from the repo root:

```bash
cd apps/arcen-demo
ARCEN_API_KEY=api_YOUR_KEY_HERE ARCEN_BASE_URL=http://localhost:3000 node scripts/test-all.js
```

### Expected output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ArcenPay SDK — E2E Test Suite
  Dashboard: http://localhost:3000
  Key:       api_xxxxxxxx...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] Companies
✅ Create company  {"id":"..."}
✅ List companies  {"count":N}
✅ Get company by ID  {"name":"Demo Co ..."}
✅ Update company traits  {"traits":{"plan_tier":"pro"}}

[2] Events
✅ Track event  "ok"
✅ Track event x5 (usage build-up)  "5 events sent"
✅ Identify event  "ok"
✅ List events (GET)  {"count":N}

[3] Feature Flags
✅ Create feature flag  {"id":"...","key":"demo-scan-..."}
✅ List feature flags  {"count":N}
✅ Check flag — default false (no rules)  {"value":false,"reason":"..."}

[4] Company Overrides
✅ Set company override → true  "override set"
✅ Check flag — should be true via override  {"value":true,"reason":"..."}
✅ Delete company override  "deleted"
✅ Check flag — back to default false  {"value":false}

[5] Access Tokens
✅ Generate access token  {"prefix":"eyJhbGciOiJIUzI1Ni..."}

[6] Security & Validation
✅ Reject invalid API key → 401  "401 ✓"
✅ Reject flag check with no company keys → 400  "400 ✓"
✅ Reject duplicate flag key → 409  "409 ✓"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  21/21 passed (100%)
  All tests passed! Protocol is working end-to-end. 🎉
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| # | Test | Expected | Result |
|---|------|----------|--------|
| 8.1 | Script runs without crash | Exits with code 0 | |
| 8.2 | All 21 tests pass | 21/21 passed | |
| 8.3 | Override flow works (true → false) | Values correct per step | |
| 8.4 | Security rejections work (401, 400, 409) | Correct HTTP status codes | |

**Paste your output here:**
```
[Paste test-all.js output here]
```

---

## Section 9 — Events Stream

**Goal:** Verify real-time event feed works.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 9.1 | Sidebar → Events | Page loads with filter pills | |
| 9.2 | After running SDK test (Section 8) | Events appear in the list | |
| 9.3 | Filter by "track" | Only track events shown | |
| 9.4 | Filter by "identify" | Only identify events shown | |
| 9.5 | Filter by "Flag Check" | Flag check events shown | |
| 9.6 | Click an event row with traits | Row expands showing JSON traits | |
| 9.7 | "Live" button is green and pulsing | Auto-refreshes every 5 seconds | |
| 9.8 | Click "Paused" | Auto-refresh stops | |

**Notes:**
```
[Write your observations here]
```

---

## Section 10 — Subscribers

**Goal:** View active subscribers (on-chain data).

| # | Test | Expected | Result |
|---|------|----------|--------|
| 10.1 | Sidebar → Subscribers | Page loads (may show empty if no on-chain subs) | |
| 10.2 | No crash on load | Clean empty state or list | |

**Notes:**
```
[Write your observations here]
```

---

## Section 11 — Invoices

**Goal:** View invoice history.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 11.1 | Sidebar → Invoices | Page loads without crash | |
| 11.2 | Empty state is clean | Shows icon + helpful message | |

**Notes:**
```
[Write your observations here]
```

---

## Section 12 — Entitlements (Developer)

**Goal:** View on-chain tier flags.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 12.1 | Sidebar → Entitlements | Page loads | |
| 12.2 | Shows per-tier on-chain flags | Flag toggles visible | |

**Notes:**
```
[Write your observations here]
```

---

## Section 13 — Settings

**Goal:** Verify settings tabs all work.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 13.1 | Sidebar → Settings | Loads with tabs | |
| 13.2 | "General" tab | Shows team/workspace info | |
| 13.3 | "Provider Keys" tab | Shows external provider keys (Stripe, etc.) | |
| 13.4 | "Protocol Keys" tab | Shows API keys panel (same as Section 7) | |

**Notes:**
```
[Write your observations here]
```

---

## Section 14 — UI Polish Checks

Quick checks to confirm UI consistency across the whole dashboard.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 14.1 | All "Create" buttons open right-side Sheet (not center popup) | Plans, Add-Ons, Credits, Companies, Flags, API Keys | |
| 14.2 | Loading states use skeleton animation (not "Loading...") | Skeleton bars visible during fetch | |
| 14.3 | Empty states show icon + title + description + CTA button | Not just plain text | |
| 14.4 | Table headers use uppercase + tracking-wider style | Consistent across all sections | |
| 14.5 | Delete buttons only appear on row hover | Opacity transition (0 → 100%) | |
| 14.6 | Sidebar collapses / expands properly | ChevronLeft / ChevronRight toggle | |
| 14.7 | Header shows correct section title + description | Changes per section | |
| 14.8 | Mainnet/Testnet badge in header changes with env mode | Orange = Mainnet, Blue = Testnet | |

**Notes:**
```
[Write your observations here]
```

---

## Reporting Back

Once you complete a section (or hit a FAIL), report back with:

1. Which section and test number failed (e.g., "6.9 — rules don't persist")
2. What you saw vs what was expected
3. Any console errors (open browser DevTools → Console tab)
4. The output from Section 8 (SDK test script)

Changes will be made based on your report and then re-tested together.
