import { db } from "../src/db.js";

type CliOptions = {
  hours: number;
  windowMinutes: number;
  json: boolean;
};

function readOptions(): CliOptions {
  const args = process.argv.slice(2);
  const readNumber = (name: string, fallback: number) => {
    const index = args.indexOf(name);
    if (index === -1) return fallback;
    const value = Number(args[index + 1]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  return {
    hours: readNumber("--hours", 168),
    windowMinutes: readNumber("--window-minutes", 30),
    json: args.includes("--json"),
  };
}

function keyForPayment(payment: {
  teamId: string;
  companyId: string | null;
  payerWallet: string | null;
  kind: string;
  amount: unknown;
  currency: string;
  invoice: { planId: string | null } | null;
}) {
  return [
    payment.teamId,
    payment.companyId ?? "no-company",
    payment.payerWallet?.toLowerCase() ?? "no-wallet",
    payment.kind,
    String(payment.amount),
    payment.currency,
    payment.invoice?.planId ?? "no-plan",
  ].join("|");
}

async function main() {
  const options = readOptions();
  const since = new Date(Date.now() - options.hours * 60 * 60 * 1000);
  const windowMs = options.windowMinutes * 60 * 1000;

  const payments = await db.payment.findMany({
    where: {
      status: "SUCCEEDED",
      kind: {
        in: [
          "SUBSCRIPTION_ACTIVATION",
          "SUBSCRIPTION_PLAN_CHANGE_UPGRADE",
        ],
      },
      occurredAt: { gte: since },
      txHash: { not: null },
    },
    orderBy: [{ teamId: "asc" }, { occurredAt: "asc" }],
    select: {
      id: true,
      teamId: true,
      companyId: true,
      invoiceId: true,
      kind: true,
      amount: true,
      currency: true,
      payerWallet: true,
      txHash: true,
      occurredAt: true,
      invoice: {
        select: {
          number: true,
          planId: true,
        },
      },
    },
  });

  const groups = new Map<string, typeof payments>();
  for (const payment of payments) {
    const key = keyForPayment(payment);
    const current = groups.get(key) ?? [];
    current.push(payment);
    groups.set(key, current);
  }

  const suspectedDuplicates = Array.from(groups.values())
    .flatMap((group) => {
      const windows: Array<typeof payments> = [];
      for (let index = 0; index < group.length; index += 1) {
        const first = group[index];
        const firstTime = first.occurredAt?.getTime();
        if (!firstTime) continue;
        const window = group.filter((payment) => {
          const occurredAt = payment.occurredAt?.getTime();
          return (
            occurredAt != null &&
            occurredAt >= firstTime &&
            occurredAt - firstTime <= windowMs
          );
        });
        if (window.length > 1) {
          windows.push(window);
        }
      }
      return windows;
    })
    .filter((window, index, all) => {
      const txHashes = window.map((payment) => payment.txHash).join("|");
      return all.findIndex((candidate) => candidate.map((payment) => payment.txHash).join("|") === txHashes) === index;
    });

  const report = suspectedDuplicates.map((window) => ({
    teamId: window[0]?.teamId ?? null,
    companyId: window[0]?.companyId ?? null,
    payerWallet: window[0]?.payerWallet ?? null,
    kind: window[0]?.kind ?? null,
    amount: String(window[0]?.amount ?? ""),
    currency: window[0]?.currency ?? null,
    planId: window[0]?.invoice?.planId ?? null,
    count: window.length,
    payments: window.map((payment) => ({
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoice?.number ?? null,
      txHash: payment.txHash,
      occurredAt: payment.occurredAt?.toISOString() ?? null,
    })),
  }));

  if (options.json) {
    console.log(JSON.stringify({ since: since.toISOString(), report }, null, 2));
    return;
  }

  console.log(`Duplicate subscription charge report since ${since.toISOString()}`);
  console.log(`Retry window: ${options.windowMinutes} minutes`);
  console.log(`Suspected duplicate groups: ${report.length}`);
  for (const group of report) {
    console.log("");
    console.log(
      [
        group.teamId,
        group.companyId,
        group.payerWallet,
        group.kind,
        `${group.amount} ${group.currency}`,
        `plan=${group.planId ?? "unknown"}`,
      ].join(" | "),
    );
    for (const payment of group.payments) {
      console.log(
        `  ${payment.occurredAt} payment=${payment.paymentId} invoice=${payment.invoiceNumber ?? payment.invoiceId ?? "none"} tx=${payment.txHash}`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
