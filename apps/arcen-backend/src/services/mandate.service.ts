import type { MandateStatus, ArcenPayAgentMandate } from "@arcenpay/internal-core";

export interface RevocationRecord {
  mandateId: string;
  reason: string;
  revokedAt: string;
  revokedBy?: string;
}

export class MandateService {
  private revoked = new Map<string, RevocationRecord>();
  private registered = new Map<string, ArcenPayAgentMandate>();

  registerMandate(mandate: ArcenPayAgentMandate): void {
    this.registered.set(mandate.mandateId, mandate);
  }

  revokeMandate(mandateId: string, reason = "Revoked by issuer", revokedBy?: string): RevocationRecord {
    const record: RevocationRecord = {
      mandateId,
      reason,
      revokedAt: new Date().toISOString(),
      revokedBy,
    };
    this.revoked.set(mandateId, record);
    return record;
  }

  getMandateStatus(mandateId: string): MandateStatus {
    const checkedAt = new Date().toISOString();
    const revocation = this.revoked.get(mandateId);
    if (revocation) {
      return {
        mandateId,
        status: "revoked",
        revokedAt: revocation.revokedAt,
        checkedAt,
      };
    }

    const registered = this.registered.get(mandateId);
    if (registered && registered.scope.validUntil) {
      if (new Date(registered.scope.validUntil).getTime() < Date.now()) {
        return {
          mandateId,
          status: "expired",
          checkedAt,
        };
      }
    }

    return {
      mandateId,
      status: "active",
      checkedAt,
    };
  }

  isRevoked(mandateId: string): boolean {
    return this.revoked.has(mandateId);
  }
}

export const mandateService = new MandateService();
