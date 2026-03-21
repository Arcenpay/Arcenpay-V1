#!/usr/bin/env node
/**
 * ArcenPay SDK — Full E2E Test Runner
 *
 * Usage:
 *   ARCEN_API_KEY=api_xxx ARCEN_BASE_URL=http://localhost:3000 node scripts/test-all.js
 *
 * This script tests every SDK method against your running dashboard instance.
 * Run the dashboard first: cd apps/arcen-dashboard && pnpm dev
 */

const BASE_URL = process.env.ARCEN_BASE_URL || "http://localhost:3000";
const API_KEY = process.env.ARCEN_API_KEY;

if (!API_KEY) {
  console.error(
    "❌  ARCEN_API_KEY is not set.\n" +
    "    1. Open the dashboard → Settings → Protocol Keys tab\n" +
    "    2. Click 'Create API Key'\n" +
    "    3. Copy the key and re-run:\n\n" +
    "       ARCEN_API_KEY=api_xxx node scripts/test-all.js\n"
  );
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function log(icon, label, detail = "") {
  const color = icon === "✅" ? "\x1b[32m" : icon === "❌" ? "\x1b[31m" : "\x1b[33m";
  const reset = "\x1b[0m";
  console.log(`${color}${icon}${reset} ${label}${detail ? `  ${"\x1b[2m"}${detail}${reset}` : ""}`);
}

async function test(name, fn) {
  try {
    const result = await fn();
    log("✅", name, result ? JSON.stringify(result).slice(0, 80) : "");
    passed++;
    return result;
  } catch (err) {
    log("❌", name, err.message);
    failed++;
    return null;
  }
}

async function apiRequest(method, path, options = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };

  if (options.companyKeys) {
    const parts = [];
    if (options.companyKeys.id) parts.push(`id=${options.companyKeys.id}`);
    if (options.companyKeys.wallet) parts.push(`wallet=${options.companyKeys.wallet}`);
    if (options.companyKeys.email) parts.push(`email=${options.companyKeys.email}`);
    if (parts.length) headers["X-Arcen-Company-Keys"] = parts.join(",");
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Test Data ────────────────────────────────────────────────────────────────

const TEST_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth for demo
const TEST_EMAIL = "demo@arcendemo.xyz";
const TEST_COMPANY_NAME = `Demo Co ${Date.now()}`;

let companyId = null;
let flagKey = null;

// ─── Run Tests ────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m");
  console.log("\x1b[1m  ArcenPay SDK — E2E Test Suite\x1b[0m");
  console.log(`  Dashboard: ${BASE_URL}`);
  console.log(`  Key:       ${API_KEY.slice(0, 12)}...`);
  console.log("\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n");

  // ── 1. Companies ─────────────────────────────────────────────────────────────
  console.log("\x1b[1m[1] Companies\x1b[0m");

  const created = await test("Create company", async () => {
    const res = await apiRequest("POST", "/api/v1/companies", {
      body: { name: TEST_COMPANY_NAME, email: TEST_EMAIL, wallet: TEST_WALLET },
    });
    companyId = res.data.id;
    return { id: companyId };
  });

  await test("List companies", async () => {
    const res = await apiRequest("GET", "/api/v1/companies", { query: { limit: "5" } });
    if (!Array.isArray(res.data)) throw new Error("data is not array");
    return { count: res.count };
  });

  await test("Get company by ID", async () => {
    if (!companyId) throw new Error("No company ID (create failed)");
    const res = await apiRequest("GET", `/api/v1/companies/${companyId}`);
    if (res.data.id !== companyId) throw new Error("ID mismatch");
    return { name: res.data.name };
  });

  await test("Update company traits", async () => {
    if (!companyId) throw new Error("No company ID");
    const res = await apiRequest("PATCH", `/api/v1/companies/${companyId}`, {
      body: { traits: { plan_tier: "pro", region: "us-east-1" } },
    });
    return { traits: res.data.traits };
  });

  // ── 2. Events ─────────────────────────────────────────────────────────────────
  console.log("\n\x1b[1m[2] Events\x1b[0m");

  await test("Track event", async () => {
    await apiRequest("POST", "/api/v1/events", {
      body: {
        event_type: "track",
        name: "scan",
        company: { wallet: TEST_WALLET },
        traits: { source: "demo-script" },
      },
    });
    return "ok";
  });

  await test("Track event x5 (usage build-up)", async () => {
    for (let i = 0; i < 5; i++) {
      await apiRequest("POST", "/api/v1/events", {
        body: { event_type: "track", name: "scan", company: { wallet: TEST_WALLET } },
      });
    }
    return "5 events sent";
  });

  await test("Identify event", async () => {
    await apiRequest("POST", "/api/v1/events", {
      body: {
        event_type: "identify",
        company: { wallet: TEST_WALLET, name: TEST_COMPANY_NAME, email: TEST_EMAIL },
        traits: { industry: "fintech" },
      },
    });
    return "ok";
  });

  await test("List events (GET)", async () => {
    const res = await apiRequest("GET", "/api/v1/events", { query: { limit: "10" } });
    if (!Array.isArray(res.data)) throw new Error("data is not array");
    return { count: res.data.length };
  });

  // ── 3. Feature Flags ──────────────────────────────────────────────────────────
  console.log("\n\x1b[1m[3] Feature Flags\x1b[0m");

  const nowMs = Date.now();
  flagKey = `demo-scan-${nowMs}`;

  await test("Create feature flag", async () => {
    const res = await apiRequest("POST", "/api/v1/feature-flags", {
      body: {
        featureKey: flagKey,
        name: `Demo Scan Flag ${nowMs}`,
        description: "Created by demo test script",
        defaultValue: false,
      },
    });
    return { id: res.data.id, key: res.data.featureKey };
  });

  await test("List feature flags", async () => {
    const res = await apiRequest("GET", "/api/v1/feature-flags");
    if (!Array.isArray(res.data)) throw new Error("data is not array");
    return { count: res.data.length };
  });

  await test("Check flag — default false (no rules)", async () => {
    if (!flagKey) throw new Error("No flag key");
    const res = await apiRequest("GET", "/api/v1/flags/check", {
      query: { key: flagKey },
      companyKeys: { wallet: TEST_WALLET },
    });
    return { value: res.data.value, reason: res.data.reason };
  });

  // ── 4. Company Override ───────────────────────────────────────────────────────
  console.log("\n\x1b[1m[4] Company Overrides\x1b[0m");

  await test("Set company override → true", async () => {
    if (!companyId || !flagKey) throw new Error("Missing companyId or flagKey");
    await apiRequest("POST", `/api/v1/companies/${companyId}/overrides`, {
      body: { featureKey: flagKey, value: true, reason: "Demo override" },
    });
    return "override set";
  });

  await test("Check flag — should be true via override", async () => {
    if (!flagKey) throw new Error("No flag key");
    const res = await apiRequest("GET", "/api/v1/flags/check", {
      query: { key: flagKey },
      companyKeys: { wallet: TEST_WALLET },
    });
    if (res.data.value !== true) throw new Error(`Expected true, got ${res.data.value}`);
    return { value: res.data.value, reason: res.data.reason };
  });

  await test("Delete company override", async () => {
    if (!companyId || !flagKey) throw new Error("Missing IDs");
    await apiRequest("DELETE", `/api/v1/companies/${companyId}/overrides`, {
      query: { featureKey: flagKey },
    });
    return "deleted";
  });

  await test("Check flag — back to default false after override removed", async () => {
    if (!flagKey) throw new Error("No flag key");
    const res = await apiRequest("GET", "/api/v1/flags/check", {
      query: { key: flagKey },
      companyKeys: { wallet: TEST_WALLET },
    });
    if (res.data.value !== false) throw new Error(`Expected false, got ${res.data.value}`);
    return { value: res.data.value };
  });

  // ── 5. Access Tokens ──────────────────────────────────────────────────────────
  console.log("\n\x1b[1m[5] Access Tokens\x1b[0m");

  await test("Generate access token", async () => {
    if (!companyId) throw new Error("No company ID");
    const res = await apiRequest("POST", "/api/v1/access-tokens", {
      body: { company: { id: companyId }, expires_in: 300 },
    });
    const token = res.data.token;
    if (!token || token.split(".").length !== 3) throw new Error("Invalid JWT format");
    return { prefix: token.slice(0, 20) + "..." };
  });

  // ── 6. Error Handling ─────────────────────────────────────────────────────────
  console.log("\n\x1b[1m[6] Security & Validation\x1b[0m");

  await test("Reject invalid API key → 401", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/companies`, {
      headers: { Authorization: "Bearer api_invalid_key_xyz" },
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    return "401 ✓";
  });

  await test("Reject flag check with no company keys → 400", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/flags/check?key=scan`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    return "400 ✓";
  });

  await test("Reject duplicate flag key → 409", async () => {
    if (!flagKey) throw new Error("No flag key");
    const res = await fetch(`${BASE_URL}/api/v1/feature-flags`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ featureKey: flagKey, name: "Duplicate", defaultValue: false }),
    });
    if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
    return "409 ✓";
  });

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log("\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m");
  const total = passed + failed;
  const pct = Math.round((passed / total) * 100);
  const color = failed === 0 ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}\x1b[1m  ${passed}/${total} passed (${pct}%)\x1b[0m`);
  if (failed > 0) {
    console.log("  \x1b[31mSome tests failed — check error messages above.\x1b[0m");
  } else {
    console.log("  \x1b[32mAll tests passed! Protocol is working end-to-end. 🎉\x1b[0m");
  }
  console.log("\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
