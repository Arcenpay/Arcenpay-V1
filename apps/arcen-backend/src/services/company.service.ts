import {
  grantCompanyAddOn,
  updateCompanyAddOnGrant,
  getCompanyAddOnGrants,
  listAddOnGrantCompanies,
  listActiveCompanyAddOnIds,
  syncCompanyAddOnCache,
  normalizeAddOnIdCache,
} from '../lib/companies/addon-grants';

export class CompanyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "CompanyError";
  }
}

export class CompanyService {
  // ── Add-On Grants ──────────────────────────────────────────────────────────

  async grantCompanyAddOn(
    input: Parameters<typeof grantCompanyAddOn>[0],
  ) {
    try {
      return await grantCompanyAddOn(input);
    } catch (error) {
      throw new CompanyError(
        error instanceof Error ? error.message : "Failed to grant add-on",
        500,
        "ADDON_GRANT_FAILED",
      );
    }
  }

  async updateCompanyAddOnGrant(
    input: Parameters<typeof updateCompanyAddOnGrant>[0],
  ) {
    try {
      return await updateCompanyAddOnGrant(input);
    } catch (error) {
      if (error instanceof Error && error.message === "Add-on grant not found") {
        throw new CompanyError(error.message, 404, "ADDON_GRANT_NOT_FOUND");
      }
      throw new CompanyError(
        error instanceof Error ? error.message : "Failed to update add-on grant",
        500,
        "ADDON_GRANT_UPDATE_FAILED",
      );
    }
  }

  async getCompanyAddOnGrants(teamId: string, companyId: string) {
    return getCompanyAddOnGrants(teamId, companyId);
  }

  async listAddOnGrantCompanies(teamId: string, catalogAddOnId: string) {
    return listAddOnGrantCompanies(teamId, catalogAddOnId);
  }

  async listActiveCompanyAddOnIds(teamId: string, companyId: string) {
    return listActiveCompanyAddOnIds(teamId, companyId);
  }

  async syncCompanyAddOnCache(teamId: string, companyId: string) {
    try {
      return await syncCompanyAddOnCache(teamId, companyId);
    } catch (error) {
      throw new CompanyError(
        error instanceof Error ? error.message : "Failed to sync add-on cache",
        500,
        "ADDON_CACHE_SYNC_FAILED",
      );
    }
  }

  normalizeAddOnIdCache(value: unknown): string[] {
    return normalizeAddOnIdCache(value);
  }
}

export const companyService = new CompanyService();
