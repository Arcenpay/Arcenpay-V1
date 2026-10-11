import { createHash, createHmac } from "crypto";
import { db } from "../../db.js";
import { ACCESS_TOKEN_SECRET } from "../../config.js";
import { secureCompare } from "../auth/secure-compare.js";

export interface EmbedAccessTokenContext {
  teamId: string;
  workspaceTeamId?: string | null;
  teamRole?: "OWNER" | "ADMIN" | "FINANCE" | "DEVELOPER" | "SUPPORT" | "MEMBER" | null;
  platformBilling?: boolean;
  environmentId: string | null;
  companyId: string | null;
  userId: string | null;
  componentId?: string | null;
  preview?: boolean;
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

    if (!secureCompare(sig, expectedSig)) return null;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      exp?: number;
      teamId?: string;
      environmentId?: string | null;
      companyId?: string | null;
      userId?: string | null;
      componentId?: string | null;
      workspaceTeamId?: string | null;
      teamRole?: EmbedAccessTokenContext["teamRole"];
      platformBilling?: boolean;
      preview?: boolean;
    };

    if (!payload.teamId) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      teamId: payload.teamId,
      workspaceTeamId: payload.workspaceTeamId ?? null,
      teamRole: payload.teamRole ?? null,
      platformBilling: payload.platformBilling === true,
      environmentId: payload.environmentId ?? null,
      companyId: payload.companyId ?? null,
      userId: payload.userId ?? null,
      componentId: payload.componentId ?? null,
      preview: payload.preview === true,
    };
  } catch {
    return null;
  }
}

export function extractEmbedAccessToken(
  headers: { get(name: string): string | null | undefined },
  searchParams?: { get(name: string): string | null },
  options?: { allowQueryParam?: boolean },
): string | null {
  const authHeader = headers.get("authorization")?.trim() ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token || null;
  }

  if (options?.allowQueryParam && searchParams) {
    const queryToken = searchParams.get("token")?.trim();
    return queryToken || null;
  }

  return null;
}

export async function resolveEmbedAccessToken(
  token: string,
): Promise<EmbedAccessTokenContext | null> {
  if (!token) return null;

  // arc_tok_… tokens are pure DB-backed, short-lived customer tokens minted
  // with a SECRET/RESTRICTED key (POST /api/v1/api-keys/tokens). No HMAC.
  if (token.startsWith("arc_tok_")) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const record = await db.embedAccessToken.findFirst({
      where: { tokenHash, expiresAt: { gt: new Date() } },
      select: {
        teamId: true,
        environmentId: true,
        companyId: true,
        userId: true,
      },
    });
    if (!record) return null;
    if (record.companyId) {
      const company = await db.arcenCompany.findFirst({
        where: {
          id: record.companyId,
          teamId: record.teamId,
          ...(record.environmentId ? { environmentId: record.environmentId } : {}),
        },
        select: { id: true },
      });
      if (!company) return null;
    }
    return {
      teamId: record.teamId,
      workspaceTeamId: null,
      environmentId: record.environmentId ?? null,
      companyId: record.companyId,
      userId: record.userId,
      componentId: null,
      teamRole: null,
      platformBilling: false,
      preview: false,
    };
  }

  if (!ACCESS_TOKEN_SECRET) return null;

  const verified = verifySignedEmbedAccessToken(token, ACCESS_TOKEN_SECRET);
  if (!verified) return null;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const record = await db.embedAccessToken.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    select: {
      teamId: true,
      environmentId: true,
      companyId: true,
      userId: true,
    },
  });

  if (!record) return null;
  if (record.teamId !== verified.teamId) return null;
  if (
    record.environmentId &&
    verified.environmentId &&
    record.environmentId !== verified.environmentId
  ) {
    return null;
  }
  if (record.companyId) {
    const company = await db.arcenCompany.findFirst({
      where: {
        id: record.companyId,
        teamId: record.teamId,
        ...(record.environmentId ? { environmentId: record.environmentId } : {}),
      },
      select: { id: true },
    });
    if (!company) return null;
  }
  return {
    teamId: record.teamId,
    workspaceTeamId: verified.workspaceTeamId ?? null,
    environmentId: record.environmentId ?? verified.environmentId ?? null,
    companyId: record.companyId,
    userId: record.userId,
    componentId: verified.componentId,
    teamRole: verified.teamRole ?? null,
    platformBilling: verified.platformBilling === true,
    preview: verified.preview,
  };
}
