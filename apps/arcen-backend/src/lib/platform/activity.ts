import { db } from "../../db.js";

export async function touchEntityActivity(
  companyId?: string | null,
  userId?: string | null,
): Promise<void> {
  await Promise.all([
    companyId
      ? db.arcenCompany
          .update({
            where: { id: companyId },
            data: { lastSeenAt: new Date() },
          })
          .catch(() => undefined)
      : Promise.resolve(undefined),
    userId
      ? db.arcenUser
          .update({
            where: { id: userId },
            data: { lastSeenAt: new Date() },
          })
          .catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
}
