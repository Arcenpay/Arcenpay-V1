import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { toPrismaJson } from "@/lib/prisma-json";

const createSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9\-]+$/),
  description: z.string().optional(),
  schemaJson: z.record(z.unknown()),
  reactBlocks: z.array(z.record(z.unknown())),
  styleTokens: z.record(z.unknown()).default({}),
  compatibility: z.record(z.unknown()).default({
    environments: ["DEVELOPMENT", "PRODUCTION"],
    chains: [11155111, 84532, 8453],
    tokens: ["USDC"],
  }),
});

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
});

export async function GET() {
  const auth = await requirePermission("templates:read");
  if (isErrorResponse(auth)) return auth;

  const templates = await db.billingTemplate.findMany({
    where: { teamId: auth.team.teamId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
      },
      installs: {
        where: { status: "INSTALLED" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission("templates:write");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const data = parsed.data;

  const template = await db.billingTemplate.create({
    data: {
      teamId: auth.team.teamId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      status: "DRAFT",
      currentVersion: 1,
      versions: {
        create: {
          version: 1,
          schemaJson: toPrismaJson(data.schemaJson),
          reactBlocks: toPrismaJson(data.reactBlocks),
          styleTokens: toPrismaJson(data.styleTokens),
          compatibility: toPrismaJson(data.compatibility),
        },
      },
    },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
      },
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "template.create",
    resourceType: "BillingTemplate",
    resourceId: template.id,
    afterData: template,
  });

  return NextResponse.json({ template }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePermission("templates:write");
  if (isErrorResponse(auth)) return auth;

  const body = await request.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const existing = await db.billingTemplate.findFirst({
    where: { id: parsed.data.id, teamId: auth.team.teamId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const updated = await db.billingTemplate.update({
    where: { id: existing.id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.status === "PUBLISHED" && {
        currentVersion: existing.currentVersion,
      }),
    },
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "template.status.update",
    resourceType: "BillingTemplate",
    resourceId: updated.id,
    beforeData: existing,
    afterData: updated,
  });

  return NextResponse.json({ template: updated });
}
