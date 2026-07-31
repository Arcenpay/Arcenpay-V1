import { db } from "../../db.js";
import { asRecord } from "./utils.js";

type PlatformTier = "FREE" | "PLUS" | "PRO";

type PlatformBillingDb = Pick<
  typeof db,
  | "platformBillingAccount"
  | "platformBillingCustomer"
  | "team"
  | "arcenCompany"
  | "subscriptionState"
  | "catalogPlan"
>;

type ConfiguredPlatformCustomer = {
  configured: true;
  created: boolean;
  providerTeamId: string;
  environmentId: string;
  portalComponentId: string | null;
  companyId: string;
};

export type PlatformBillingCustomerResult =
  | ConfiguredPlatformCustomer
  | { configured: false; created: false; reason: "not_configured" | "workspace_not_found" };

function readPlatformTier(value: unknown): PlatformTier | null {
  const metadata = asRecord(value);
  const tier = metadata.platformTier ?? metadata.tier;
  return tier === "FREE" || tier === "PLUS" || tier === "PRO" ? tier : null;
}

/** Returns the durable first-party customer identity for a workspace. */
export async function ensurePlatformBillingCustomer(
  input: { workspaceTeamId: string; environmentId?: string | null },
  client: PlatformBillingDb = db,
): Promise<PlatformBillingCustomerResult> {
  const account = input.environmentId
    ? (await client.platformBillingAccount.findFirst({
        where: { environmentId: input.environmentId },
        select: { providerTeamId: true, environmentId: true, portalComponentId: true },
      })) ?? (await client.platformBillingAccount.findFirst({
        select: { providerTeamId: true, environmentId: true, portalComponentId: true },
      }))
    : (await client.platformBillingAccount.findUnique({
        where: { id: "default" },
        select: { providerTeamId: true, environmentId: true, portalComponentId: true },
      })) ?? (await client.platformBillingAccount.findFirst({
        select: { providerTeamId: true, environmentId: true, portalComponentId: true },
      }));
  if (!account) return { configured: false, created: false, reason: "not_configured" };

  const existing = await client.platformBillingCustomer.findUnique({
    where: { workspaceTeamId: input.workspaceTeamId },
    select: { companyId: true, providerTeamId: true, environmentId: true },
  });
  if (existing && (!existing.providerTeamId || existing.providerTeamId === account.providerTeamId)) {
    return { configured: true, created: false, ...account, companyId: existing.companyId };
  }

  const workspace = await client.team.findUnique({
    where: { id: input.workspaceTeamId },
    select: { id: true, name: true },
  });
  if (!workspace) return { configured: false, created: false, reason: "workspace_not_found" };

  const externalId = `workspace:${workspace.id}`;
  let company = await client.arcenCompany.findFirst({
    where: { teamId: account.providerTeamId, environmentId: account.environmentId, externalId },
    select: { id: true },
  });
  let created = false;
  if (!company) {
    company = await client.arcenCompany.create({
      data: {
        teamId: account.providerTeamId,
        environmentId: account.environmentId,
        externalId,
        name: workspace.name,
        traits: { platformWorkspaceTeamId: workspace.id },
      },
      select: { id: true },
    });
    created = true;
  }

  try {
    if (existing) {
      await client.platformBillingCustomer.update({
        where: { workspaceTeamId: workspace.id },
        data: {
          providerTeamId: account.providerTeamId,
          environmentId: account.environmentId,
          companyId: company.id,
        },
        select: { id: true },
      });
    } else {
      await client.platformBillingCustomer.create({
        data: {
          workspaceTeamId: workspace.id,
          providerTeamId: account.providerTeamId,
          environmentId: account.environmentId,
          companyId: company.id,
        },
        select: { id: true },
      });
    }
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
    const concurrent = await client.platformBillingCustomer.findUnique({
      where: { workspaceTeamId: workspace.id },
      select: { companyId: true },
    });
    if (!concurrent) throw error;
    company = { id: concurrent.companyId };
  }

  return { configured: true, created, ...account, companyId: company.id };
}

/**
 * Projects a verified first-party subscription to its workspace's tier. A
 * PAST_DUE subscription keeps its last tier until normal dunning cancels it.
 */
export async function projectPlatformBillingEntitlement(
  input: { providerTeamId: string; companyId: string },
  client: PlatformBillingDb = db,
): Promise<{ projected: boolean; tier: PlatformTier | null; workspaceTeamId: string | null }> {
  const mapping = await client.platformBillingCustomer.findUnique({
    where: { companyId: input.companyId },
    select: { workspaceTeamId: true, providerTeamId: true },
  });
  if (!mapping || mapping.providerTeamId !== input.providerTeamId) {
    return { projected: false, tier: null, workspaceTeamId: null };
  }

  const subscription = await client.subscriptionState.findUnique({
    where: { companyId: input.companyId },
    select: {
      id: true,
      status: true,
      currentPeriodEnd: true,
      catalogPlanId: true,
    },
  });
  if (!subscription) return { projected: false, tier: null, workspaceTeamId: mapping.workspaceTeamId };

  const plan = subscription.catalogPlanId
    ? await client.catalogPlan.findUnique({
        where: { id: subscription.catalogPlanId },
        select: { metadata: true },
      })
    : null;
  const workspace = await client.team.findUnique({
    where: { id: mapping.workspaceTeamId },
    select: { platformTier: true, tierSubscriptionId: true, tierExpiresAt: true },
  });
  if (!workspace) return { projected: false, tier: null, workspaceTeamId: mapping.workspaceTeamId };

  const tier = subscription.status === "CANCELLED"
    ? "FREE"
    : subscription.status === "ACTIVE"
      ? readPlatformTier(plan?.metadata)
      : workspace.platformTier as PlatformTier;
  if (!tier) return { projected: false, tier: null, workspaceTeamId: mapping.workspaceTeamId };

  const tierSubscriptionId = tier === "FREE" ? null : subscription.id;
  const tierExpiresAt = tier === "FREE" ? null : subscription.currentPeriodEnd;
  if (
    workspace.platformTier === tier &&
    workspace.tierSubscriptionId === tierSubscriptionId &&
    workspace.tierExpiresAt?.getTime() === tierExpiresAt?.getTime()
  ) {
    return { projected: false, tier, workspaceTeamId: mapping.workspaceTeamId };
  }

  await client.team.update({
    where: { id: mapping.workspaceTeamId },
    data: { platformTier: tier, tierSubscriptionId, tierExpiresAt },
  });
  return { projected: true, tier, workspaceTeamId: mapping.workspaceTeamId };
}
