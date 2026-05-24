import { db } from "../../db.js";

function normalizeName(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeWallet(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export async function syncCustomerUserIdentity(input: {
  companyId: string;
  userId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  walletAddress?: string | null;
}): Promise<string | null> {
  const customerName = normalizeName(input.customerName);
  const customerEmail = normalizeEmail(input.customerEmail);
  const walletAddress = normalizeWallet(input.walletAddress);

  if (!customerName && !customerEmail && !walletAddress) {
    return null;
  }

  const selectedUser =
    input.userId
      ? await db.arcenUser.findUnique({
          where: { id: input.userId },
          select: {
            id: true,
            companyId: true,
            name: true,
            email: true,
            walletAddress: true,
          },
        })
      : null;

  const user =
    selectedUser?.companyId === input.companyId
      ? selectedUser
      : await db.arcenUser.findFirst({
          where: {
            companyId: input.companyId,
            OR: [
              ...(walletAddress ? [{ walletAddress }] : []),
              ...(customerEmail ? [{ email: customerEmail }] : []),
            ],
          },
          select: {
            id: true,
            name: true,
            email: true,
            walletAddress: true,
          },
        });

  if (!user) {
    return null;
  }

  const updates: {
    name?: string;
    email?: string;
    walletAddress?: string;
  } = {};

  if (customerName && user.name?.trim() !== customerName) {
    updates.name = customerName;
  }
  if (
    customerEmail &&
    user.email?.trim().toLowerCase() !== customerEmail
  ) {
    updates.email = customerEmail;
  }
  if (
    walletAddress &&
    user.walletAddress?.trim().toLowerCase() !== walletAddress
  ) {
    updates.walletAddress = walletAddress;
  }

  if (Object.keys(updates).length === 0) {
    return user.id;
  }

  await db.arcenUser.update({
    where: { id: user.id },
    data: updates,
  });

  return user.id;
}
