import { ActivationKeyService, generateActivationKeyCode } from "../src/services/activation-key.service.js";
import { db } from "../src/db.js";
import type { PlatformTier } from "../src/generated/client/client.js";

async function main() {
  const args = process.argv.slice(2);
  const nameArg = args.find((a) => a.startsWith("--name="))?.split("=")[1] || "Default Production Access";
  const tierArg = (args.find((a) => a.startsWith("--tier="))?.split("=")[1]?.toUpperCase() || "PRO") as PlatformTier;
  const allowBillingArg = args.find((a) => a.startsWith("--allow-billing="))?.split("=")[1] !== "false";
  const maxUsesArg = parseInt(args.find((a) => a.startsWith("--max-uses="))?.split("=")[1] || "1", 10);
  const emailArg = args.find((a) => a.startsWith("--email="))?.split("=")[1];
  const expiresDaysArg = args.find((a) => a.startsWith("--expires-days="))?.split("=")[1];

  let expiresAt: Date | undefined = undefined;
  if (expiresDaysArg) {
    const days = parseInt(expiresDaysArg, 10);
    if (!isNaN(days) && days > 0) {
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
  }

  console.log("Creating Platform Activation Key...");
  console.log({
    name: nameArg,
    tier: tierArg,
    allowPlatformBilling: allowBillingArg,
    maxUses: maxUsesArg,
    expiresAt: expiresAt?.toISOString() || "never",
    recipientEmail: emailArg || "(none)",
  });

  const key = await ActivationKeyService.createActivationKey({
    name: nameArg,
    tier: tierArg,
    allowPlatformBilling: allowBillingArg,
    maxUses: maxUsesArg,
    recipientEmail: emailArg,
    expiresAt,
    notes: "Generated via CLI script",
  });

  console.log("\n========================================================");
  console.log("  PLATFORM ACTIVATION KEY GENERATED SUCCESSFULLY!");
  console.log("========================================================");
  console.log(`  Key Code:                ${key.key}`);
  console.log(`  Name:                    ${key.name}`);
  console.log(`  Granted Tier:            ${key.tier}`);
  console.log(`  Allow Platform Billing:  ${key.allowPlatformBilling}`);
  console.log(`  Max Redemptions:         ${key.maxUses}`);
  console.log(`  Status:                  ${key.status}`);
  console.log("========================================================\n");
}

main()
  .catch((err) => {
    console.error("Failed to create activation key:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
