import { createHash, createHmac, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

type CommandMode = "baseline" | "env" | "live" | "all";

type ParsedArgs = {
  mode: CommandMode;
  paymentAccount?: `0x${string}`;
  planId?: string;
  wrongPlanId?: string;
  subscriberEmail?: string;
  dashboardUrl?: string;
  facilitatorUrl?: string;
  demoUrl?: string;
  apiKey?: string;
  componentId?: string;
  evidenceDir?: string;
  label?: string;
  allowExistingSubscription?: boolean;
};

type CommandResult = {
  name: string;
  cwd: string;
  command: string[];
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  ok: boolean;
};

type EnvCheck = {
  name: string;
  ok: boolean;
  actual?: string | boolean | number | null;
  expected?: string | boolean | number | null;
  note?: string;
};

type JsonRecord = Record<string, unknown>;

const ROOT = process.cwd();
const DEFAULT_EVIDENCE_DIR = path.join(ROOT, "docs", "production", "evidence");
const ROOT_ENV_PATH = path.join(ROOT, ".env");
const DASHBOARD_ENV_PATH = path.join(ROOT, "apps", "arcen-dashboard", ".env");
const FACILITATOR_ENV_PATH = path.join(ROOT, "apps", "facilitator", ".env");
const DEMO_ENV_PATH = path.join(ROOT, "apps", "arcen-demo", ".env.local");

function parseArgs(argv: string[]): ParsedArgs {
  const [rawMode, ...rest] = argv;
  const mode = (rawMode || "all") as CommandMode;
  if (!["baseline", "env", "live", "all"].includes(mode)) {
    throw new Error(
      `Unknown mode "${rawMode}". Use one of: baseline, env, live, all.`,
    );
  }

  const args: ParsedArgs = { mode };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    const next = rest[i + 1];
    switch (token) {
      case "--payment-account":
        args.paymentAccount = next as `0x${string}`;
        i += 1;
        break;
      case "--plan-id":
        args.planId = next;
        i += 1;
        break;
      case "--wrong-plan-id":
        args.wrongPlanId = next;
        i += 1;
        break;
      case "--subscriber-email":
        args.subscriberEmail = next;
        i += 1;
        break;
      case "--dashboard-url":
        args.dashboardUrl = next;
        i += 1;
        break;
      case "--facilitator-url":
        args.facilitatorUrl = next;
        i += 1;
        break;
      case "--demo-url":
        args.demoUrl = next;
        i += 1;
        break;
      case "--api-key":
        args.apiKey = next;
        i += 1;
        break;
      case "--component-id":
        args.componentId = next;
        i += 1;
        break;
      case "--evidence-dir":
        args.evidenceDir = next;
        i += 1;
        break;
      case "--label":
        args.label = next;
        i += 1;
        break;
      case "--allow-existing-subscription":
        args.allowExistingSubscription = true;
        break;
      default:
        throw new Error(`Unknown argument "${token}".`);
    }
  }

  return args;
}

function parseEnvFile(contents: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    env[key] = value;
  }
  return env;
}

async function loadEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const contents = await fs.readFile(filePath, "utf8");
    return parseEnvFile(contents);
  } catch {
    return {};
  }
}

function normalizeUrl(url: string | undefined): string {
  return (url || "").trim().replace(/\/$/, "");
}

function effectiveDashboardUrl(
  rootEnv: Record<string, string>,
  facilitatorEnv: Record<string, string>,
  demoEnv: Record<string, string>,
  cliValue?: string,
): string {
  return (
    normalizeUrl(cliValue) ||
    normalizeUrl(demoEnv.ARCENPAY_BASE_URL) ||
    normalizeUrl(facilitatorEnv.DASHBOARD_URL) ||
    normalizeUrl(rootEnv.NEXT_PUBLIC_APP_URL) ||
    normalizeUrl(rootEnv.NEXTAUTH_URL) ||
    "http://localhost:3000"
  );
}

function effectiveFacilitatorUrl(
  dashboardEnv: Record<string, string>,
  cliValue?: string,
): string {
  return (
    normalizeUrl(cliValue) ||
    normalizeUrl(dashboardEnv.FACILITATOR_URL) ||
    "http://localhost:3402"
  );
}

function effectiveDemoUrl(cliValue?: string): string {
  return normalizeUrl(cliValue) || "http://localhost:3001";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function runCommand(
  command: string[],
  cwd: string,
): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (code) => {
      resolve({
        name: path.basename(cwd),
        cwd,
        command,
        exitCode: code ?? 1,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        ok: (code ?? 1) === 0,
      });
    });
  });
}

async function ensureEvidenceDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function isoStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function requireValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required value: ${name}`);
  return value;
}

async function createDashboardDbClient(dashboardEnv: Record<string, string>) {
  process.env.DATABASE_URL = requireValue(
    "apps/arcen-dashboard/.env DATABASE_URL",
    dashboardEnv.DATABASE_URL,
  );

  const [{ Pool }, { PrismaPg }, { PrismaClient }] = await Promise.all([
    import("pg"),
    import("@prisma/adapter-pg"),
    import("../apps/arcen-backend/src/generated/client/client.ts"),
  ]);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter, log: ["error"] });

  return { db, pool };
}

async function createChainClients(rpcUrl: string, chainId: number) {
  const { createPublicClient, http, parseAbi } = await import("viem");
  const chains = await import("viem/chains");
  const { getContractAddresses } =
    await import("../packages/internal-core/src/index.ts");

  const chain =
    chainId === 11155111
      ? chains.sepolia
      : chainId === 84532
        ? chains.baseSepolia
        : chainId === 8453
          ? chains.base
          : chains.sepolia;

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const contracts = getContractAddresses(chainId);

  const abis = {
    subscriptionRegistry: parseAbi([
      "function authorizedBillers(address) view returns (bool)",
      "function getWalletSubscription(address) view returns (uint256)",
      "function expiresAt(uint256) view returns (uint64)",
    ]),
    autopayModule: parseAbi([
      "function isInitialized(address) view returns (bool)",
      "function getConfig(address) view returns ((address merchant,uint256 maxAmount,address token,uint32 interval,uint64 startTime,uint256 planId,uint256 maxTotalAmount))",
    ]),
    planFactory: parseAbi([
      "function getPlan(uint256) view returns ((uint256 id,address provider,string name,string tier,uint256 price,uint32 billingInterval,address acceptedToken,bool active,string metadataURI))",
    ]),
  };

  return { publicClient, abis, contracts };
}

function buildSignedInvoiceUrl(input: {
  appUrl: string;
  invoiceId: string;
  objectKey: string;
  secret: string;
  ttlSeconds?: number;
}): string {
  const exp = Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? 86400);
  const payload = `${input.invoiceId}.${input.objectKey}.${exp}`;
  const sig = createHmac("sha256", input.secret)
    .update(payload)
    .digest("base64url");
  return `${input.appUrl}/api/invoices/public/${encodeURIComponent(
    input.invoiceId,
  )}/download?key=${encodeURIComponent(input.objectKey)}&exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

function createRandomAddress(): `0x${string}` {
  return `0x${randomBytes(20).toString("hex")}`;
}

async function runBaselineSuite(): Promise<CommandResult[]> {
  return Promise.all([
    runCommand(
      [
        "npm",
        "test",
        "--",
        "invoice-documents.test.ts",
        "security.test.ts",
        "app/api/internal/companies/sync-subscription/__tests__/route.test.ts",
      ],
      path.join(ROOT, "apps", "arcen-dashboard"),
    ),
    runCommand(
      ["npm", "test", "--", "client.test.ts"],
      path.join(ROOT, "packages", "sdk-node"),
    ),
    runCommand(
      [
        "npm",
        "test",
        "--",
        "checkout-modal.test.ts",
        "api-utils.test.ts",
        "error-codes.test.ts",
      ],
      path.join(ROOT, "packages", "sdk-react"),
    ),
  ]);
}

function buildEnvAlignmentReport(input: {
  rootEnv: Record<string, string>;
  dashboardEnv: Record<string, string>;
  facilitatorEnv: Record<string, string>;
  demoEnv: Record<string, string>;
  dashboardUrl: string;
  facilitatorUrl: string;
  demoUrl: string;
}): { ok: boolean; checks: EnvCheck[] } {
  const {
    rootEnv,
    dashboardEnv,
    facilitatorEnv,
    demoEnv,
    dashboardUrl,
    facilitatorUrl,
    demoUrl,
  } = input;
  const dashboardChainId =
    dashboardEnv.NEXT_PUBLIC_CHAIN_ID || rootEnv.CHAIN_ID || "11155111";
  const facilitatorChainId = facilitatorEnv.CHAIN_ID || "11155111";
  const demoBaseUrl = normalizeUrl(demoEnv.ARCENPAY_BASE_URL);
  const facilitatorDashboardUrl = normalizeUrl(facilitatorEnv.DASHBOARD_URL);
  const invoiceStorageExplicit = Boolean(rootEnv.INVOICE_STORAGE_DIR);
  const invoiceSecretExplicit = Boolean(
    rootEnv.INVOICE_DOWNLOAD_SIGNING_SECRET,
  );

  const checks: EnvCheck[] = [
    {
      name: "chain_id_alignment",
      ok: dashboardChainId === facilitatorChainId,
      actual: dashboardChainId,
      expected: facilitatorChainId,
    },
    {
      name: "dashboard_url_demo_alignment",
      ok: demoBaseUrl === dashboardUrl,
      actual: demoBaseUrl || null,
      expected: dashboardUrl,
    },
    {
      name: "dashboard_url_facilitator_alignment",
      ok: facilitatorDashboardUrl === dashboardUrl,
      actual: facilitatorDashboardUrl || null,
      expected: dashboardUrl,
    },
    {
      name: "facilitator_secret_alignment",
      ok:
        Boolean(dashboardEnv.FACILITATOR_SECRET) &&
        dashboardEnv.FACILITATOR_SECRET === facilitatorEnv.FACILITATOR_SECRET,
      actual: dashboardEnv.FACILITATOR_SECRET ? "configured" : "missing",
      expected: facilitatorEnv.FACILITATOR_SECRET
        ? "configured + matching"
        : "missing",
    },
    {
      name: "invoice_storage_configured",
      ok: true,
      actual:
        rootEnv.INVOICE_STORAGE_DIR || "/tmp/arcenpay/invoices (dev fallback)",
      expected: "filesystem path",
      note: invoiceStorageExplicit
        ? "Explicit invoice storage dir configured."
        : "Using dashboard development fallback.",
    },
    {
      name: "invoice_signing_secret_configured",
      ok: invoiceSecretExplicit || Boolean(dashboardEnv.SIWE_JWT_SECRET),
      actual: invoiceSecretExplicit
        ? "explicit"
        : "development fallback via SIWE_JWT_SECRET",
      expected: "signing secret",
    },
    {
      name: "demo_api_key_present",
      ok: Boolean(demoEnv.ARCENPAY_API_KEY),
      actual: demoEnv.ARCENPAY_API_KEY ? "configured" : "missing",
      expected: "configured",
    },
    {
      name: "demo_component_id_present",
      ok: Boolean(demoEnv.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID),
      actual: demoEnv.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID || null,
      expected: "component id",
    },
    {
      name: "service_url_defaults",
      ok: Boolean(dashboardUrl && facilitatorUrl && demoUrl),
      actual: JSON.stringify({ dashboardUrl, facilitatorUrl, demoUrl }),
      expected: "non-empty URLs",
    },
  ];

  return { ok: checks.every((check) => check.ok), checks };
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{
  status: number;
  ok: boolean;
  headers: Headers;
  body: unknown;
}> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body,
  };
}

async function runLiveVerification(
  args: ParsedArgs,
  envs: {
    rootEnv: Record<string, string>;
    dashboardEnv: Record<string, string>;
    facilitatorEnv: Record<string, string>;
    demoEnv: Record<string, string>;
  },
): Promise<JsonRecord> {
  const { rootEnv, dashboardEnv, facilitatorEnv, demoEnv } = envs;
  const dashboardUrl = effectiveDashboardUrl(
    rootEnv,
    facilitatorEnv,
    demoEnv,
    args.dashboardUrl,
  );
  const facilitatorUrl = effectiveFacilitatorUrl(
    dashboardEnv,
    args.facilitatorUrl,
  );
  const chainId = Number(
    dashboardEnv.NEXT_PUBLIC_CHAIN_ID || facilitatorEnv.CHAIN_ID || "11155111",
  );
  const rpcUrl =
    dashboardEnv[`RPC_URL_${chainId}`] ||
    facilitatorEnv.RPC_URL ||
    rootEnv[`ARCENPAY_RPC_URL_${chainId}`] ||
    rootEnv[`MEAP_RPC_URL_${chainId}`] ||
    rootEnv[`RPC_URL_${chainId}`] ||
    rootEnv.SEPOLIA_RPC_URL;

  const apiKey = args.apiKey || demoEnv.ARCENPAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Live verification needs an API key. Set apps/arcen-demo/.env.local ARCENPAY_API_KEY or pass --api-key.",
    );
  }
  if (!args.paymentAccount) {
    throw new Error("Live verification requires --payment-account.");
  }
  if (!rpcUrl) {
    throw new Error(`Unable to resolve RPC URL for chain ${chainId}.`);
  }

  const { db, pool } = await createDashboardDbClient(dashboardEnv);
  const startedAt = new Date();

  try {
    const apiKeyHash = sha256(apiKey);
    const apiKeyRecord = await db.arcenApiKey.findUnique({
      where: { keyHash: apiKeyHash },
      select: { id: true, teamId: true, prefix: true },
    });
    if (!apiKeyRecord) {
      throw new Error("Configured API key was not found in dashboard DB.");
    }

    const paidPlans = await db.catalogPlan.findMany({
      where: {
        teamId: apiKeyRecord.teamId,
        active: true,
        status: "PUBLISHED",
        onChainPlanId: { not: null },
        price: { gt: 0 },
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        price: true,
        onChainPlanId: true,
      },
    });
    if (paidPlans.length === 0) {
      throw new Error(
        "No active published paid plans with on-chain IDs were found for the API key team.",
      );
    }

    const chosenPlan =
      (args.planId
        ? paidPlans.find((plan) => plan.onChainPlanId === args.planId)
        : paidPlans[0]) ?? null;
    if (!chosenPlan || !chosenPlan.onChainPlanId) {
      throw new Error(`Unable to resolve plan ${args.planId ?? "(auto)"}.`);
    }

    const alternatePlan =
      (args.wrongPlanId
        ? paidPlans.find((plan) => plan.onChainPlanId === args.wrongPlanId)
        : paidPlans.find(
            (plan) => plan.onChainPlanId !== chosenPlan.onChainPlanId,
          )) ?? null;

    const componentId =
      args.componentId ||
      demoEnv.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID ||
      (
        await db.embedComponent.findFirst({
          where: { teamId: apiKeyRecord.teamId },
          orderBy: [{ updatedAt: "desc" }],
          select: { id: true },
        })
      )?.id ||
      null;

    const { publicClient, abis, contracts } = await createChainClients(
      rpcUrl,
      chainId,
    );
    const subscriptionRegistryAddress =
      (facilitatorEnv.SUBSCRIPTION_REGISTRY_ADDRESS ||
        contracts.subscriptionRegistry) as `0x${string}`;
    const autopayModuleAddress = contracts.autopayModule as
      | `0x${string}`
      | undefined;
    const planFactoryAddress = (facilitatorEnv.PLAN_FACTORY_ADDRESS ||
      contracts.planFactory) as `0x${string}`;

    if (!subscriptionRegistryAddress || !planFactoryAddress) {
      throw new Error(
        "Facilitator env is missing subscription registry or plan factory address.",
      );
    }

    const billingAutopayAddress =
      autopayModuleAddress ||
      ("0x0000000000000000000000000000000000000000" as `0x${string}`);

    const [
      onChainPlan,
      autopayAuthorized,
      autopayInitialized,
      existingWalletTokenId,
    ] = await Promise.all([
      publicClient.readContract({
        address: planFactoryAddress,
        abi: abis.planFactory,
        functionName: "getPlan",
        args: [BigInt(chosenPlan.onChainPlanId)],
      }) as Promise<{
        id: bigint;
        provider: `0x${string}`;
        name: string;
        tier: string;
        price: bigint;
        billingInterval: number;
        acceptedToken: `0x${string}`;
        active: boolean;
        metadataURI: string;
      }>,
      billingAutopayAddress !== "0x0000000000000000000000000000000000000000"
        ? (publicClient.readContract({
            address: subscriptionRegistryAddress,
            abi: abis.subscriptionRegistry,
            functionName: "authorizedBillers",
            args: [billingAutopayAddress],
          }) as Promise<boolean>)
        : Promise.resolve(false),
      billingAutopayAddress !== "0x0000000000000000000000000000000000000000"
        ? (publicClient.readContract({
            address: billingAutopayAddress,
            abi: abis.autopayModule,
            functionName: "isInitialized",
            args: [args.paymentAccount],
          }) as Promise<boolean>)
        : Promise.resolve(false),
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: abis.subscriptionRegistry,
        functionName: "getWalletSubscription",
        args: [args.paymentAccount],
      }) as Promise<bigint>,
    ]);

    const autopayConfig =
      autopayInitialized &&
      billingAutopayAddress !== "0x0000000000000000000000000000000000000000"
        ? ((await publicClient.readContract({
            address: billingAutopayAddress,
            abi: abis.autopayModule,
            functionName: "getConfig",
            args: [args.paymentAccount],
          })) as {
            merchant: `0x${string}`;
            maxAmount: bigint;
            token: `0x${string}`;
            interval: number;
            startTime: bigint;
            planId: bigint;
            maxTotalAmount: bigint;
          })
        : null;

    if (existingWalletTokenId > 0n && !args.allowExistingSubscription) {
      throw new Error(
        `Payment account ${args.paymentAccount} already has on-chain subscription token ${existingWalletTokenId.toString()}. Pass --allow-existing-subscription to continue anyway.`,
      );
    }

    const subscriberEmail =
      args.subscriberEmail || `billing-check+${Date.now()}@example.com`;

    const subscriberEmailRegistration = await fetchJson(
      `${facilitatorUrl}/api/subscriber/email`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: args.paymentAccount,
          email: subscriberEmail,
          planId: chosenPlan.id,
        }),
      },
    );

    const activationRequestBody = {
      planId: chosenPlan.onChainPlanId,
      paymentAccount: args.paymentAccount,
      subscriberEmail,
      company: {
        wallet: args.paymentAccount,
        email: subscriberEmail,
        name: "Hybrid Billing Verification",
      },
    };

    const activationResponse = await fetchJson(
      `${dashboardUrl}/api/v1/subscriptions/activate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(activationRequestBody),
      },
    );

    if (!activationResponse.ok) {
      throw new Error(
        `Activation failed with status ${activationResponse.status}: ${JSON.stringify(
          activationResponse.body,
        )}`,
      );
    }

    const activationData = (activationResponse.body as { data?: JsonRecord })
      .data as
      | {
          tokenId: string;
          txHash: `0x${string}`;
          companyId: string;
          planId: string;
          paymentAccount: `0x${string}`;
        }
      | undefined;
    if (!activationData) {
      throw new Error("Activation response did not include a data payload.");
    }

    const [walletSubscriptionTokenId, tokenExpiry] = await Promise.all([
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: abis.subscriptionRegistry,
        functionName: "getWalletSubscription",
        args: [args.paymentAccount],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: subscriptionRegistryAddress,
        abi: abis.subscriptionRegistry,
        functionName: "expiresAt",
        args: [BigInt(activationData.tokenId)],
      }) as Promise<bigint>,
    ]);

    const company = await db.arcenCompany.findUnique({
      where: { id: activationData.companyId },
      select: {
        id: true,
        activePlanId: true,
        walletAddress: true,
        email: true,
      },
    });

    const billingEvent = await db.billingEvent.findUnique({
      where: { idempotencyKey: `subscription.minted:${activationData.txHash}` },
      select: {
        id: true,
        eventType: true,
        idempotencyKey: true,
        processed: true,
        processedAt: true,
        payload: true,
      },
    });

    const invoice = await db.invoice.findFirst({
      where: {
        teamId: apiKeyRecord.teamId,
        customerWallet: args.paymentAccount.toLowerCase(),
        planId: activationData.planId,
        createdAt: { gte: startedAt },
      },
      include: {
        deliveries: { orderBy: { createdAt: "desc" }, take: 5 },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    if (!invoice) {
      throw new Error("Invoice record was not found after activation.");
    }

    const appUrl =
      normalizeUrl(rootEnv.NEXT_PUBLIC_APP_URL) ||
      normalizeUrl(rootEnv.NEXTAUTH_URL) ||
      dashboardUrl;
    const invoiceSigningSecret =
      rootEnv.INVOICE_DOWNLOAD_SIGNING_SECRET ||
      dashboardEnv.INVOICE_DOWNLOAD_SIGNING_SECRET ||
      dashboardEnv.SIWE_JWT_SECRET ||
      rootEnv.SIWE_JWT_SECRET;
    if (!invoiceSigningSecret) {
      throw new Error("Unable to resolve invoice download signing secret.");
    }
    if (!invoice.externalRef) {
      throw new Error("Invoice PDF object key was not generated.");
    }

    const signedInvoiceUrl = buildSignedInvoiceUrl({
      appUrl,
      invoiceId: invoice.id,
      objectKey: invoice.externalRef,
      secret: invoiceSigningSecret,
      ttlSeconds: Number(rootEnv.INVOICE_DOWNLOAD_URL_TTL_SECONDS || 86400),
    });
    const signedInvoiceResponse = await fetch(signedInvoiceUrl);

    const accessTokenResponse = await fetchJson(
      `${dashboardUrl}/api/v1/access-tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company: { id: activationData.companyId },
          expires_in: 3600,
        }),
      },
    );
    const accessToken = (
      accessTokenResponse.body as { data?: { token?: string } }
    ).data?.token;
    if (!accessToken) {
      throw new Error(
        "Failed to create access token for component render verification.",
      );
    }

    const renderResponse = componentId
      ? await fetchJson(
          `${dashboardUrl}/api/v1/components/${componentId}/render`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        )
      : {
          ok: false,
          status: 0,
          headers: new Headers(),
          body: { error: "No component id available" },
        };

    const recentInvoices =
      ((
        renderResponse.body as {
          data?: { recentInvoices?: Array<Record<string, unknown>> };
        }
      ).data?.recentInvoices as Array<Record<string, unknown>> | undefined) ??
      [];

    const invoiceCountBeforeReplay = await db.invoice.count({
      where: {
        teamId: apiKeyRecord.teamId,
        customerWallet: args.paymentAccount.toLowerCase(),
      },
    });

    const replayBody = {
      teamId: apiKeyRecord.teamId,
      eventType: "SUBSCRIPTION_MINTED",
      eventName: "subscription.minted",
      idempotencyKey: `subscription.minted:${activationData.txHash}`,
      payload:
        typeof billingEvent?.payload === "object" && billingEvent?.payload
          ? (billingEvent.payload as Record<string, unknown>)
          : {
              tokenId: activationData.tokenId,
              planId: activationData.planId,
              customerWallet: args.paymentAccount.toLowerCase(),
              email: subscriberEmail,
              amount: Number(onChainPlan.price) / 1e6,
              txHash: activationData.txHash,
              description: `Subscription activation — ${chosenPlan.name}`,
            },
      triggerInvoice: true,
      source: "verification.replay",
    };

    const replayResponse = await fetchJson(
      `${dashboardUrl}/api/billing/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireValue("FACILITATOR_SECRET", dashboardEnv.FACILITATOR_SECRET || facilitatorEnv.FACILITATOR_SECRET)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(replayBody),
      },
    );

    const invoiceCountAfterReplay = await db.invoice.count({
      where: {
        teamId: apiKeyRecord.teamId,
        customerWallet: args.paymentAccount.toLowerCase(),
      },
    });

    const noAutopayAccount = createRandomAddress();
    const missingAutopayResponse = await fetchJson(
      `${dashboardUrl}/api/v1/subscriptions/activate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...activationRequestBody,
          paymentAccount: noAutopayAccount,
          company: {
            wallet: noAutopayAccount,
            email: `missing-autopay+${Date.now()}@example.com`,
            name: "Hybrid Missing Autopay Check",
          },
          subscriberEmail: `missing-autopay+${Date.now()}@example.com`,
        }),
      },
    );

    const wrongPlanResponse = alternatePlan?.onChainPlanId
      ? await fetchJson(`${dashboardUrl}/api/v1/subscriptions/activate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...activationRequestBody,
            planId: alternatePlan.onChainPlanId,
          }),
        })
      : null;

    return {
      ok: true,
      startedAt: startedAt.toISOString(),
      preflight: {
        dashboardUrl,
        facilitatorUrl,
        chainId,
        apiKeyPrefix: apiKeyRecord.prefix,
        teamId: apiKeyRecord.teamId,
        componentId,
        chosenPlan,
        alternatePlan: alternatePlan
          ? {
              id: alternatePlan.id,
              name: alternatePlan.name,
              onChainPlanId: alternatePlan.onChainPlanId,
            }
          : null,
        onChainPlan: {
          id: onChainPlan.id.toString(),
          provider: onChainPlan.provider,
          token: onChainPlan.acceptedToken,
          price: onChainPlan.price.toString(),
          billingInterval: onChainPlan.billingInterval,
          active: onChainPlan.active,
          name: onChainPlan.name,
          tier: onChainPlan.tier,
          metadataURI: onChainPlan.metadataURI,
        },
        autopay: {
          moduleAddress: billingAutopayAddress,
          authorizedBiller: autopayAuthorized,
          initialized: autopayInitialized,
          config: autopayConfig
            ? {
                merchant: autopayConfig.merchant,
                token: autopayConfig.token,
                maxAmount: autopayConfig.maxAmount.toString(),
                interval: autopayConfig.interval,
                startTime: autopayConfig.startTime.toString(),
                planId: autopayConfig.planId.toString(),
                maxTotalAmount: autopayConfig.maxTotalAmount.toString(),
              }
            : null,
          existingWalletTokenId: existingWalletTokenId.toString(),
        },
      },
      subscriberEmailRegistration: {
        status: subscriberEmailRegistration.status,
        ok: subscriberEmailRegistration.ok,
        body: subscriberEmailRegistration.body,
      },
      activation: {
        request: activationRequestBody,
        status: activationResponse.status,
        response: activationResponse.body,
      },
      chainVerification: {
        walletSubscriptionTokenId: walletSubscriptionTokenId.toString(),
        tokenExpiry: tokenExpiry.toString(),
        tokenIdMatchesResponse:
          walletSubscriptionTokenId.toString() === activationData.tokenId,
      },
      dbVerification: {
        company,
        billingEvent: billingEvent
          ? {
              id: billingEvent.id,
              eventType: billingEvent.eventType,
              idempotencyKey: billingEvent.idempotencyKey,
              processed: billingEvent.processed,
              processedAt: billingEvent.processedAt?.toISOString() ?? null,
            }
          : null,
        invoice: {
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          externalRef: invoice.externalRef,
          customerEmail: invoice.customerEmail,
          customerWallet: invoice.customerWallet,
          total: String(invoice.total),
          deliveries: invoice.deliveries.map((delivery) => ({
            id: delivery.id,
            status: delivery.status,
            attempts: delivery.attempts,
            errorMessage: delivery.errorMessage,
          })),
        },
      },
      invoiceDownload: {
        signedInvoiceUrl,
        status: signedInvoiceResponse.status,
        contentType: signedInvoiceResponse.headers.get("content-type"),
        contentDisposition: signedInvoiceResponse.headers.get(
          "content-disposition",
        ),
        ok:
          signedInvoiceResponse.ok &&
          (signedInvoiceResponse.headers.get("content-type") || "").includes(
            "application/pdf",
          ),
      },
      customerFacingVisibility: {
        componentRenderStatus: renderResponse.status,
        componentRenderOk: renderResponse.ok,
        invoiceVisibleInRecentInvoices: recentInvoices.some(
          (entry) => entry.id === invoice.id,
        ),
        recentInvoiceIds: recentInvoices.map((entry) => entry.id),
      },
      negativeChecks: {
        missingAutopay: {
          testedAccount: noAutopayAccount,
          status: missingAutopayResponse.status,
          body: missingAutopayResponse.body,
          passed:
            missingAutopayResponse.status === 409 &&
            JSON.stringify(missingAutopayResponse.body).includes(
              "Autopay is not installed",
            ),
        },
        wrongPlan: wrongPlanResponse
          ? {
              testedPlanId:
                alternatePlan?.onChainPlanId ?? args.wrongPlanId ?? null,
              status: wrongPlanResponse.status,
              body: wrongPlanResponse.body,
              passed:
                wrongPlanResponse.status === 409 &&
                JSON.stringify(wrongPlanResponse.body).includes(
                  "Autopay config mismatch",
                ),
            }
          : {
              skipped: true,
              reason:
                "No alternate published paid on-chain plan available for wrong-plan mismatch check.",
            },
        idempotencyReplay: {
          status: replayResponse.status,
          body: replayResponse.body,
          invoiceCountBeforeReplay,
          invoiceCountAfterReplay,
          passed:
            replayResponse.ok &&
            (replayResponse.body as { deduped?: boolean }).deduped === true &&
            invoiceCountBeforeReplay === invoiceCountAfterReplay,
        },
      },
    };
  } finally {
    await db.$disconnect();
    await pool.end();
  }
}

async function main(args: ParsedArgs) {
  const [rootEnv, dashboardEnv, facilitatorEnv, demoEnv] = await Promise.all([
    loadEnvFile(ROOT_ENV_PATH),
    loadEnvFile(DASHBOARD_ENV_PATH),
    loadEnvFile(FACILITATOR_ENV_PATH),
    loadEnvFile(DEMO_ENV_PATH),
  ]);

  const dashboardUrl = effectiveDashboardUrl(
    rootEnv,
    facilitatorEnv,
    demoEnv,
    args.dashboardUrl,
  );
  const facilitatorUrl = effectiveFacilitatorUrl(
    dashboardEnv,
    args.facilitatorUrl,
  );
  const demoUrl = effectiveDemoUrl(args.demoUrl);
  const evidenceDir = path.resolve(args.evidenceDir || DEFAULT_EVIDENCE_DIR);
  const label = args.label || isoStamp();

  await ensureEvidenceDir(evidenceDir);

  const summary: JsonRecord = {
    mode: args.mode,
    label,
    startedAt: new Date().toISOString(),
    environmentFiles: {
      root: ROOT_ENV_PATH,
      dashboard: DASHBOARD_ENV_PATH,
      facilitator: FACILITATOR_ENV_PATH,
      demo: DEMO_ENV_PATH,
    },
  };

  if (args.mode === "baseline" || args.mode === "all") {
    const baselineResults = await runBaselineSuite();
    const baselineOk = baselineResults.every((result) => result.ok);
    summary.baseline = {
      ok: baselineOk,
      results: baselineResults,
    };
  }

  if (args.mode === "env" || args.mode === "all" || args.mode === "live") {
    summary.envAlignment = buildEnvAlignmentReport({
      rootEnv,
      dashboardEnv,
      facilitatorEnv,
      demoEnv,
      dashboardUrl,
      facilitatorUrl,
      demoUrl,
    });
  }

  if (args.mode === "live" || args.mode === "all") {
    summary.live = await runLiveVerification(args, {
      rootEnv,
      dashboardEnv,
      facilitatorEnv,
      demoEnv,
    });
  }

  summary.completedAt = new Date().toISOString();

  const outputPath = path.join(
    evidenceDir,
    `billing-hybrid-${args.mode}-${label}.json`,
  );
  await writeJson(outputPath, summary);

  console.log(
    JSON.stringify({ ok: true, outputPath, mode: args.mode }, null, 2),
  );
}

const cliArgs = parseArgs(process.argv.slice(2));

main(cliArgs).catch(async (error) => {
  const message =
    error instanceof Error ? error.stack || error.message : String(error);
  const evidenceDir = path.resolve(cliArgs.evidenceDir || DEFAULT_EVIDENCE_DIR);
  const label = cliArgs.label || isoStamp();

  try {
    await ensureEvidenceDir(evidenceDir);
    const failurePath = path.join(
      evidenceDir,
      `billing-hybrid-${cliArgs.mode}-${label}-error.json`,
    );
    await writeJson(failurePath, {
      ok: false,
      mode: cliArgs.mode,
      label,
      failedAt: new Date().toISOString(),
      error: message,
    });
    console.error(
      JSON.stringify(
        { ok: false, outputPath: failurePath, error: message },
        null,
        2,
      ),
    );
  } catch {
    console.error(message);
  }

  process.exitCode = 1;
});
