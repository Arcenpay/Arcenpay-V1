import "dotenv/config";
import { db } from "../lib/db";
import { runBillingMaintenance } from "../lib/billing-maintenance";

const teamId = process.argv[2];
const executeDunning = process.argv.includes("--execute-dunning");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

if (!teamId) {
  console.error(
    "Usage: tsx scripts/run-billing-maintenance.ts <teamId> [--execute-dunning] [--limit=100]",
  );
  process.exit(1);
}

async function main() {
  const result = await runBillingMaintenance({
    teamId,
    executeDunning,
    limit,
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error("Billing maintenance failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
