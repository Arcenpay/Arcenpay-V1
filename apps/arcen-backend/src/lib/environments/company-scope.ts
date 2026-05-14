import type { Prisma } from "../../generated/client/client.js";

export async function getCompanyEnvironmentWhere(
  environmentId: string,
): Promise<Prisma.ArcenCompanyWhereInput> {
  return {
    environmentId,
  };
}
