import { Prisma } from "../generated/client/client.js";

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return cloneJson(value) as Prisma.InputJsonValue;
}

export function toPrismaNullableJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return toPrismaJson(value);
}
