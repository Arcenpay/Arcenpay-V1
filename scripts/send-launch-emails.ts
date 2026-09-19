// ============================================================
//  ArcenPay — Official Platform Launch Announcement (Resend)
//
//  Sends a clean, customer-friendly launch announcement from
//  hello@arcenpay.com via the Resend API.
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// ── Image Assets (Hosted on official domain for reliable email rendering) ──────
const LOGO_IMAGE_URL = "https://app.arcenpay.com/arcenpay-logo.png";
const HERO_IMAGE_URL = "https://app.arcenpay.com/arcenpay-launch-hero.jpg";

// ── Official Verified Links ──────────────────────────────────────────────────
const APP_URL = "https://app.arcenpay.com";
const DOCS_INTRO_URL = "https://docs.arcenpay.com/introduction";
const SDK_REACT_URL = "https://docs.arcenpay.com/sdk/react/overview";
const CONTACT_URL = "https://www.arcenpay.com/contact";
const PRIVACY_URL = "https://www.arcenpay.com/privacy";
const TERMS_URL = "https://www.arcenpay.com/terms";
const TWITTER_URL = "https://x.com/arcenpayhq";
const LINKEDIN_URL = "https://www.linkedin.com/company/arcenpay";

const DEFAULT_FROM = "ArcenPay <hello@arcenpay.com>";
const DEFAULT_SUBJECT = "Arcenpay is live — The Web3 Entitlement Layer";
const DEFAULT_CAMPAIGN = "launch-v7";
const DEFAULT_STATE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".launch-campaign-state.json",
);
const DEFAULT_DELAY_MS = 800;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── CLI Arg Parser ───────────────────────────────────────────────────────────

interface CliArgs {
  to: string | null;
  name: string | null;
  csv: string;
  from: string;
  subject: string;
  campaign: string;
  stateFile: string;
  delayMs: number;
  concurrency: number;
  limit: number;
  dryRun: boolean;
  preview: string | null;
  resetState: boolean;
  noResume: boolean;
  yes: boolean;
  help: boolean;
  env: string | null;
  [key: string]: string | number | boolean | null;
}

function parseArgs(argv: string[]): CliArgs {
  const defaults: CliArgs = {
    to: null,
    name: null,
    csv: "scripts/data/waitlist-users.csv",
    from: DEFAULT_FROM,
    subject: DEFAULT_SUBJECT,
    campaign: DEFAULT_CAMPAIGN,
    stateFile: DEFAULT_STATE_FILE,
    delayMs: DEFAULT_DELAY_MS,
    concurrency: 1,
    limit: 0,
    dryRun: false,
    preview: null,
    resetState: false,
    noResume: false,
    yes: false,
    help: false,
    env: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--to": defaults.to = next(); break;
      case "--name": defaults.name = next(); break;
      case "--csv": defaults.csv = next(); break;
      case "--from": defaults.from = next(); break;
      case "--subject": defaults.subject = next(); break;
      case "--campaign": defaults.campaign = next(); break;
      case "--state-file": defaults.stateFile = next(); break;
      case "--env": defaults.env = next(); break;
      case "--delay-ms": defaults.delayMs = Number(next()); break;
      case "--concurrency": defaults.concurrency = Number(next()); break;
      case "--limit": defaults.limit = Number(next()); break;
      case "--preview": defaults.preview = next(); break;
      case "--dry-run": defaults.dryRun = true; break;
      case "--reset-state": defaults.resetState = true; break;
      case "--no-resume": defaults.noResume = true; break;
      case "--yes": defaults.yes = true; break;
      case "--help":
      case "-h": defaults.help = true; break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown flag: ${arg} (run with --help for usage)`);
        }
        break;
    }
  }
  return defaults;
}

// ── CSV Parsing ──────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

interface Recipient {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function loadRecipients(csvPath: string, allowFallback = false): Recipient[] {
  let abs = resolve(process.cwd(), csvPath);
  if (!existsSync(abs) && allowFallback) {
    const example = resolve(process.cwd(), "scripts/data/waitlist-users.csv");
    if (existsSync(example)) abs = example;
  }
  if (!existsSync(abs)) {
    throw new Error(`Recipient CSV not found: ${abs}`);
  }
  const rows = parseCsv(readFileSync(abs, "utf8"));
  const headerCandidates = new Set(["email", "email_address", "emailaddress", "mail"]);
  let headerIdx: Record<string, number> | null = null;
  if (rows.length > 0) {
    const norm = rows[0].map(normalizeHeader);
    if (norm.some((h) => headerCandidates.has(h))) {
      headerIdx = {} as Record<string, number>;
      norm.forEach((h, i) => {
        headerIdx![h] = i;
        if ((h.startsWith("first") || h === "name") && headerIdx!.firstName === undefined)
          headerIdx!.firstName = i;
        if (h.startsWith("last") && headerIdx!.lastName === undefined)
          headerIdx!.lastName = i;
        if ((h.startsWith("company") || h.startsWith("org")) && headerIdx!.company === undefined)
          headerIdx!.company = i;
      });
      rows.shift();
    }
  }

  const emailCol = headerIdx?.email ?? headerIdx?.email_address ?? headerIdx?.mail ?? 0;
  const get = (row: string[], col: number | undefined): string =>
    col === undefined ? "" : (row[col] ?? "").trim();

  const out: Recipient[] = [];
  for (const row of rows) {
    const email = get(row, emailCol).toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    out.push({
      email,
      firstName: get(row, headerIdx?.firstName),
      lastName: get(row, headerIdx?.lastName),
      company: get(row, headerIdx?.company),
    });
  }
  return out;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function looksLikeRealName(name: string): boolean {
  const cleaned = name.trim().toLowerCase();
  if (cleaned.length < 2) return false;
  if (cleaned.includes("@")) return false;
  if (/^\d+$/.test(cleaned)) return false;
  const placeholders = new Set([
    "user", "hello", "test", "me", "name", "firstname",
    "unknown", "admin", "n/a", "na", "none", "person",
  ]);
  return !placeholders.has(cleaned);
}

function capitalizeName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function personalizedGreeting(v: {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
}): string {
  const first = v.firstName?.trim();
  const company = v.company?.trim();

  let name: string | null = null;
  if (first && looksLikeRealName(first)) {
    name = capitalizeName(first.split(/\s+/)[0]);
  }

  if (!name) return "Hi there,";
  if (company && looksLikeRealName(company)) {
    return `Hi ${esc(name)} from ${esc(company)},`;
  }
  return `Hi ${esc(name)},`;
}

// ── HTML Template Builder (Customer-Friendly, Clear & Compelling) ────────────

export function buildEmailHtml(v: {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
}): string {
  const greeting = personalizedGreeting(v);
  const brandBlue = "#0001fd"; // Exact Arcenpay brand blue

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Arcenpay is live</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- Preheader text -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;height:0;width:0;">
    The Web3 Entitlement Layer is live. Recurring subscriptions, usage metering, and AI agent payments.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:32px 12px;">
    <tr>
      <td align="center">
        <!-- Main Email Container (580px max-width) -->
        <table role="presentation" width="580" cellpadding="0" cellspacing="0"
               style="max-width:580px;width:100%;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.04);">

          <!-- Clean Header (Official Logo Only) -->
          <tr>
            <td style="padding:32px 36px 20px 36px;background-color:#ffffff;">
              <a href="${APP_URL}" style="display:inline-block;text-decoration:none;">
                <img src="${LOGO_IMAGE_URL}" alt="Arcenpay" width="152" height="40"
                     style="display:block;height:38px;width:auto;border:0;outline:none;" />
              </a>
            </td>
          </tr>

          <!-- Subtle Divider -->
          <tr>
            <td style="padding:0 36px;">
              <div style="height:1px;background-color:#f1f5f9;line-height:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Main Content Area -->
          <tr>
            <td style="padding:28px 36px 24px 36px;background-color:#ffffff;">
              <!-- Headline -->
              <h1 style="margin:0 0 18px 0;font-size:26px;line-height:1.25;font-weight:800;color:#0a0a0a;letter-spacing:-0.03em;">
                The Web3 entitlement layer is live.
              </h1>

              <!-- Hero Artwork Media Card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td>
                    <div style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;line-height:0;background-color:#050508;box-shadow:0 4px 14px rgba(0,0,0,0.06);">
                      <a href="${APP_URL}" style="display:block;text-decoration:none;">
                        <img src="${HERO_IMAGE_URL}"
                             alt="Arcenpay | Web3 entitlement layer"
                             width="508"
                             style="display:block;width:100%;height:auto;border:0;outline:none;" />
                      </a>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Intro Copy -->
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#334155;">
                ${greeting}
              </p>

              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#334155;">
                Building billing for Web3 applications and AI agents shouldn't require complex contract engineering or custom payment custody. Today, that changes.
              </p>

              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.65;color:#0a0a0a;">
                <strong>Arcenpay is now live as your complete billing platform.</strong> Create subscription plans, meter API usage with credits, and enable AI agents to pay autonomously — all managed seamlessly from your dashboard.
              </p>

              <!-- Three Things Worth Knowing (Customer-friendly, clear) -->
              <p style="margin:0 0 12px 0;font-size:14px;font-weight:800;color:#0a0a0a;">
                Three things worth knowing:
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="vertical-align:top;padding:0 0 10px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:22px;vertical-align:top;font-size:14px;font-weight:800;color:${brandBlue};line-height:1.65;">1.</td>
                        <td style="font-size:14px;line-height:1.65;color:#334155;">
                          <strong>Automated Recurring Subscriptions:</strong> Bill customers in stablecoins (USDC) on Base and Ethereum with automated recurring renewals — no custom smart contracts needed.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="vertical-align:top;padding:0 0 10px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:22px;vertical-align:top;font-size:14px;font-weight:800;color:${brandBlue};line-height:1.65;">2.</td>
                        <td style="font-size:14px;line-height:1.65;color:#334155;">
                          <strong>Usage Credits &amp; Metering:</strong> Track API usage and burn credits in real time per request or token, with instant notifications before balances run out.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="vertical-align:top;padding:0 0 10px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:22px;vertical-align:top;font-size:14px;font-weight:800;color:${brandBlue};line-height:1.65;">3.</td>
                        <td style="font-size:14px;line-height:1.65;color:#334155;">
                          <strong>AI Agent Payments:</strong> Enable autonomous AI agents to negotiate and pay for API access on-the-fly with verifiable wallet budgets.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px 0;font-size:14px;line-height:1.65;color:#334155;">
                You shouldn't need multiple vendors to monetize your product or AI agents. Arcenpay gives you the complete billing stack from day one.
              </p>

              <!-- Primary Call to Action Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;">
                <tr>
                  <td>
                    <a href="${APP_URL}"
                       style="display:block;width:100%;text-align:center;background-color:${brandBlue};color:#ffffff;font-size:15px;font-weight:700;padding:14px 0;border-radius:9999px;text-decoration:none;box-sizing:border-box;letter-spacing:0.01em;">
                      Open your dashboard &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <div style="height:1px;background-color:#e2e8f0;margin:0 0 28px 0;"></div>

              <!-- "The platform at a glance" -->
              <h2 style="margin:0 0 20px 0;font-size:19px;font-weight:800;color:#0a0a0a;letter-spacing:-0.02em;">
                The platform at a glance
              </h2>

              <!-- Feature 1: Subscriptions -->
              <div style="margin-bottom:18px;">
                <h3 style="margin:0 0 6px 0;font-size:15px;font-weight:700;color:#0a0a0a;">
                  Subscriptions &amp; Plans
                </h3>
                <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:#475569;">
                  Create custom pricing plans, manage subscribers, and accept recurring crypto payments directly from your dashboard.
                </p>
                <a href="${APP_URL}" style="font-size:13px;color:${brandBlue};font-weight:600;text-decoration:underline;">
                  Create your first plan &rarr;
                </a>
              </div>
              <div style="height:1px;background-color:#f1f5f9;margin:0 0 18px 0;"></div>

              <!-- Feature 2: Usage Credits -->
              <div style="margin-bottom:18px;">
                <h3 style="margin:0 0 6px 0;font-size:15px;font-weight:700;color:#0a0a0a;">
                  Usage Credits &amp; Metering
                </h3>
                <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:#475569;">
                  Grant, meter, and burn credits in real time with automatic low-balance webhooks to keep services running smoothly.
                </p>
                <a href="${DOCS_INTRO_URL}" style="font-size:13px;color:${brandBlue};font-weight:600;text-decoration:underline;">
                  Read the documentation &rarr;
                </a>
              </div>
              <div style="height:1px;background-color:#f1f5f9;margin:0 0 18px 0;"></div>

              <!-- Feature 3: AI Agent Payments -->
              <div style="margin-bottom:18px;">
                <h3 style="margin:0 0 6px 0;font-size:15px;font-weight:700;color:#0a0a0a;">
                  Autonomous Agent Payments
                </h3>
                <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:#475569;">
                  Allow AI agents to autonomously discover pricing, negotiate payments, and access your APIs with verified spending limits.
                </p>
                <a href="${DOCS_INTRO_URL}" style="font-size:13px;color:${brandBlue};font-weight:600;text-decoration:underline;">
                  Learn about agent payments &rarr;
                </a>
              </div>
              <div style="height:1px;background-color:#f1f5f9;margin:0 0 18px 0;"></div>

              <!-- Feature 4: Developer SDKs -->
              <div style="margin-bottom:28px;">
                <h3 style="margin:0 0 6px 0;font-size:15px;font-weight:700;color:#0a0a0a;">
                  Developer SDKs &amp; Components
                </h3>
                <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:#475569;">
                  Integrate checkout and paywalls into your frontend in minutes with pre-built React components and Node.js SDKs.
                </p>
                <a href="${SDK_REACT_URL}" style="font-size:13px;color:${brandBlue};font-weight:600;text-decoration:underline;">
                  View React SDK reference &rarr;
                </a>
              </div>

              <!-- Clean Talk to Us Card (No images, minimal and professional) -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="margin:0 0 12px 0;border:1px solid #e2e8f0;border-radius:8px;background-color:#fafbfc;text-align:center;">
                <tr>
                  <td style="padding:32px 28px 30px 28px;">
                    <h3 style="margin:0 0 10px 0;font-size:20px;font-weight:800;color:#0a0a0a;letter-spacing:-0.02em;">
                      Ready to monetize your product or AI agents?
                    </h3>
                    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#64748b;max-width:440px;margin-left:auto;margin-right:auto;">
                      Whether you're integrating recurring subscriptions or autonomous agent payments, our team is here to help you get started.
                    </p>
                    <!-- Button: 'Talk to us' linked to https://www.arcenpay.com/contact -->
                    <a href="${CONTACT_URL}"
                       style="display:inline-block;border:1.5px solid #0a0a0a;background-color:#ffffff;color:#0a0a0a;font-size:14px;font-weight:700;padding:10px 36px;border-radius:9999px;text-decoration:none;">
                      Talk to us
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Solid Brand Blue Footer with Social Icons -->
          <tr>
            <td style="padding:24px 20px 26px 20px;background-color:${brandBlue};text-align:center;">
              <!-- Social Icons -->
              <p style="margin:0 0 12px 0;font-size:16px;font-weight:700;">
                <a href="${LINKEDIN_URL}" style="color:#ffffff;text-decoration:none;margin:0 10px;font-family:sans-serif;" title="LinkedIn">in</a>
                &nbsp;&nbsp;
                <a href="${TWITTER_URL}" style="color:#ffffff;text-decoration:none;margin:0 10px;font-family:sans-serif;" title="X (Twitter)">𝕏</a>
              </p>
              <p style="margin:0 0 6px 0;font-size:11px;color:#ffffff;line-height:1.5;">
                &copy; 2026 Arcenpay, Inc. All rights reserved.
              </p>
              <p style="margin:0;font-size:11px;color:#ffffff;line-height:1.5;">
                <a href="${PRIVACY_URL}" style="color:#ffffff;text-decoration:underline;">Privacy Policy</a>
                &nbsp;&middot;&nbsp;
                <a href="${TERMS_URL}" style="color:#ffffff;text-decoration:underline;">Terms of Service</a>
                &nbsp;&middot;&nbsp;
                <a href="${CONTACT_URL}" style="color:#ffffff;text-decoration:underline;">Contact</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Resume / State Tracking ──────────────────────────────────────────────────

interface CampaignState {
  [hash: string]: { sentAt: string; resendId: string | null };
}

function loadState(stateFile: string, reset: boolean): CampaignState {
  if (reset) return {};
  if (!existsSync(stateFile)) return {};
  try {
    return JSON.parse(readFileSync(stateFile, "utf8")) as CampaignState;
  } catch {
    return {};
  }
}

function saveState(stateFile: string, state: CampaignState): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function recipientHash(campaign: string, subject: string, email: string): string {
  return createHash("sha256")
    .update(`${campaign}::${subject}::${email.toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

// ── Resend Delivery ──────────────────────────────────────────────────────────

interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

async function sendWithResend(
  opts: {
    apiKey: string;
    from: string;
    to: string;
    subject: string;
    html: string;
  },
  retries = 3,
): Promise<SendResult> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.status === 429 && attempt < retries) {
      const waitMs = 2000 * (attempt + 1);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      return { ok: false, error: body.message || `HTTP ${res.status} ${res.statusText}` };
    }
    return { ok: true, id: body.id };
  }
  return { ok: false, error: "Rate limit exceeded (max retries)" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(tag: string, msg: string): void {
  console.log(`[${new Date().toISOString()}] ${tag} ${msg}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.resetState && existsSync(args.stateFile)) {
    writeFileSync(args.stateFile, "{}");
    log("state", `Reset ${args.stateFile}`);
  }

  if (args.env) {
    const envPath = resolve(process.cwd(), args.env);
    loadEnvFile(envPath);
    log("env", `Loaded ${envPath}`);
  } else if (!process.env.RESEND_API_KEY) {
    const defaultEnv = resolve(process.cwd(), ".env");
    const prodEnv = resolve(process.cwd(), ".env.prod");
    if (existsSync(defaultEnv)) {
      try { loadEnvFile(defaultEnv); } catch {}
    }
    if (!process.env.RESEND_API_KEY && existsSync(prodEnv)) {
      try { loadEnvFile(prodEnv); } catch {}
    }
  }

  const apiKey = process.env.RESEND_API_KEY?.trim() || "";
  if (!apiKey && !args.dryRun && !args.preview) {
    console.error("Missing RESEND_API_KEY. Set it in .env or pass --env .env");
    process.exit(1);
  }

  let list: Recipient[];
  if (args.to) {
    list = [
      {
        email: args.to.trim().toLowerCase(),
        firstName: args.name?.trim() || "Aditya",
        lastName: "",
        company: "",
      },
    ];
  } else {
    const loaded = loadRecipients(args.csv, Boolean(args.preview) || args.dryRun);
    const unique = new Map<string, Recipient>();
    for (const r of loaded) unique.set(r.email, r);
    list = [...unique.values()];
  }

  const limited = args.limit > 0 ? list.slice(0, args.limit) : list;

  if (list.length === 0) {
    console.error("No valid recipients found.");
    process.exit(1);
  }

  console.log("");
  log("campaign", args.campaign);
  log("from", args.from);
  log("subject", args.subject);
  log("recipients", `${list.length} total (${list.length - limited.length} deferred by --limit)`);
  log("mode", args.dryRun ? "DRY-RUN (no emails sent)" : args.preview ? `PREVIEW -> ${args.preview}` : "LIVE");

  if (args.preview) {
    const html = buildEmailHtml({
      firstName: list[0].firstName,
      lastName: list[0].lastName,
      company: list[0].company,
      email: list[0].email,
    });
    const abs = resolve(process.cwd(), args.preview);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, html);
    log("preview", `Wrote ${abs} for ${list[0].email} — open in browser to review.`);
    process.exit(0);
  }

  const state = loadState(args.stateFile, false);
  const queue = [...limited];
  const seen = new Set<string>();

  const stats = { attempts: 0, sent: 0, skipped: 0, failed: 0 };
  const failures: Array<{ email: string; error: string }> = [];

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const recipient = queue.shift()!;
      if (seen.has(recipient.email)) continue;
      seen.add(recipient.email);

      const hash = recipientHash(args.campaign, args.subject, recipient.email);
      if (!args.noResume && state[hash]) {
        stats.skipped++;
        log("skip", `${recipient.email} (already sent ${state[hash].sentAt})`);
        continue;
      }

      const html = buildEmailHtml({
        firstName: recipient.firstName,
        lastName: recipient.lastName,
        company: recipient.company,
        email: recipient.email,
      });

      if (args.dryRun) {
        stats.sent++;
        log("ready", `${recipient.email}`);
        continue;
      }

      stats.attempts++;
      const result = await sendWithResend({
        apiKey,
        from: args.from,
        to: recipient.email,
        subject: args.subject,
        html,
      });

      if (result.ok) {
        stats.sent++;
        state[hash] = { sentAt: new Date().toISOString(), resendId: result.id ?? null };
        saveState(args.stateFile, state);
        log("sent", `${recipient.email} -> ${result.id}`);
      } else {
        stats.failed++;
        failures.push({ email: recipient.email, error: result.error ?? "unknown error" });
        log("fail", `${recipient.email} <- ${result.error}`);
      }

      if (queue.length > 0 && args.delayMs > 0) {
        await sleep(args.delayMs);
      }
    }
  };

  const workers = Array.from(
    { length: Math.max(1, Math.min(args.concurrency, 5)) },
    () => worker(),
  );
  await Promise.all(workers);

  console.log("");
  log("summary", `attempted=${stats.attempts} sent=${stats.sent} skipped=${stats.skipped} failed=${stats.failed}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.email}: ${f.error}`);
  }
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
