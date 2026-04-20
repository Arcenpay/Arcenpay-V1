import { createHash, createHmac } from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export interface EmbedAccessTokenContext {
  teamId: string;
  companyId: string | null;
  userId: string | null;
}

function verifySignedEmbedAccessToken(
  token: string,
  secret: string,
): EmbedAccessTokenContext | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts;
    const unsigned = `${header}.${body}`;
    const expectedSig = createHmac("sha256", secret)
      .update(unsigned)
      .digest("base64url");

    if (sig !== expectedSig) return null;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      exp?: number;
      teamId?: string;
      companyId?: string | null;
      userId?: string | null;
    };

    if (!payload.teamId) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      teamId: payload.teamId,
      companyId: payload.companyId ?? null,
      userId: payload.userId ?? null,
    };
  } catch {
    return null;
  }
}

export function extractEmbedAccessToken(
  request: NextRequest,
  options?: { allowQueryParam?: boolean },
): string | null {
  const authHeader = request.headers.get("authorization")?.trim() ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token || null;
  }

  if (options?.allowQueryParam) {
    const queryToken = request.nextUrl.searchParams.get("token")?.trim();
    return queryToken || null;
  }

  return null;
}

export async function resolveEmbedAccessToken(
  token: string,
): Promise<EmbedAccessTokenContext | null> {
  if (!token) return null;

  const secret = (process.env.ACCESS_TOKEN_SECRET || "").trim();
  if (!secret) return null;

  const verified = verifySignedEmbedAccessToken(token, secret);
  if (!verified) return null;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const record = await db.embedAccessToken.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    select: { teamId: true, companyId: true, userId: true },
  });

  if (!record) return null;
  return {
    teamId: verified.teamId,
    companyId: record.companyId,
    userId: record.userId,
  };
}
