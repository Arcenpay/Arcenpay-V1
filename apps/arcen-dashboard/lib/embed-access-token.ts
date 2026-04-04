import { createHash } from "crypto";
import { db } from "@/lib/db";

export interface EmbedAccessTokenContext {
  teamId: string;
  companyId: string | null;
  userId: string | null;
}

export async function resolveEmbedAccessToken(
  token: string,
): Promise<EmbedAccessTokenContext | null> {
  if (!token) return null;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const record = await db.embedAccessToken.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    select: { teamId: true, companyId: true, userId: true },
  });

  if (!record) return null;
  return record;
}
