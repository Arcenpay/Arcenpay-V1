import "server-only";

import { ArcenClient } from "@arcenpay/node/client";
import {
  buildReceiptCompanyIdentity,
  buildReceiptUserIdentity,
} from "@/lib/receipt-billing";

function createArcenPayClient() {
  const apiKey = process.env.ARCENPAY_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ARCENPAY_API_KEY is not configured. Add it before using billing enforcement.",
    );
  }

  return new ArcenClient({ apiKey });
}

type ReceiptBillingSessionInput = {
  clerkUserId: string;
  email?: string | null;
  name?: string | null;
  walletAddress?: string | null;
};

export async function getReceiptBillingClient(
  input: ReceiptBillingSessionInput,
) {
  const client = createArcenPayClient();

  await client.identify({
    company: buildReceiptCompanyIdentity(input),
    user: buildReceiptUserIdentity(input),
  });

  return client;
}
