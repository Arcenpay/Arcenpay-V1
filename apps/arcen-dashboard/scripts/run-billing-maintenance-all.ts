import "dotenv/config";
import { db } from "../lib/db";
import { runBillingMaintenanceForAllTeams } from "../lib/billing-maintenance";

const executeDunning = process.argv.includes("--execute-dunning");
const teamLimitArg = process.argv.find((arg) => arg.startsWith("--team-limit="));
const limitPerTeamArg = process.argv.find((arg) =>
  arg.startsWith("--limit-per-team="),
);

const teamLimit = teamLimitArg ? Number(teamLimitArg.split("=")[1]) : undefined;
const limitPerTeam = limitPerTeamArg
  ? Number(limitPerTeamArg.split("=")[1])
  : undefined;

async function main() {
  const result = await runBillingMaintenanceForAllTeams({
    executeDunning,
    teamLimit,
    limitPerTeam,
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error("Bulk billing maintenance failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
