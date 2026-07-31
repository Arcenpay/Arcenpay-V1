import type { Context } from "hono";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import {
  enrollWorkspaceInPlatformBilling,
  getPlatformBillingStatus,
  issuePlatformBillingEmbedToken,
} from "../../../lib/billing/platform-enrollment.js";

export async function getPlatformBillingStatusRoute(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN", "FINANCE", "DEVELOPER", "SUPPORT", "MEMBER"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);
  return c.json(await getPlatformBillingStatus(auth.team.teamId));
}

export async function postPlatformBillingEnrollment(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);
  const result = await enrollWorkspaceInPlatformBilling({
    workspaceTeamId: auth.team.teamId,
    workspaceEnvironmentId: auth.session.activeEnvironmentId,
    email: undefined,
    name: undefined,
  });
  return c.json({ ok: true, ...result }, 201 as any);
}

export async function postPlatformBillingEmbed(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN", "FINANCE", "DEVELOPER", "SUPPORT", "MEMBER"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const status = await getPlatformBillingStatus(auth.team.teamId);
  if (!status.configured || !status.enrolled || !status.customer || !status.portalComponentId) {
    return c.json({
      error: "Platform billing is not enrolled for this workspace.",
      code: "PLATFORM_BILLING_NOT_ENROLLED",
    }, 409 as any);
  }

  const issued = await issuePlatformBillingEmbedToken({
    workspaceTeamId: auth.team.teamId,
    providerTeamId: status.providerTeamId,
    companyId: status.customer.companyId,
    componentId: status.portalComponentId,
    environmentId: status.environmentId,
  });
  return c.json({ token: issued.token, componentId: status.portalComponentId, expiresAt: issued.expiresAt.toISOString() });
}
