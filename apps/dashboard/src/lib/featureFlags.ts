export const TIERS = ["starter", "pro", "enterprise"] as const;
export type FeatureTier = (typeof TIERS)[number];

export interface FeatureMatrixFlag {
  key: string;
  description: string;
  tiers: Record<FeatureTier, boolean>;
}

export const DEFAULT_FLAGS: FeatureMatrixFlag[] = [
  {
    key: "analytics_dashboard",
    description: "Access to analytics dashboard with charts and exports",
    tiers: { starter: false, pro: true, enterprise: true },
  },
  {
    key: "api_access",
    description: "Programmatic API access with key management",
    tiers: { starter: false, pro: true, enterprise: true },
  },
  {
    key: "custom_branding",
    description: "White-label branding and custom themes",
    tiers: { starter: false, pro: false, enterprise: true },
  },
  {
    key: "priority_support",
    description: "Priority support with 24/7 SLA",
    tiers: { starter: false, pro: false, enterprise: true },
  },
  {
    key: "webhook_integration",
    description: "Real-time webhook notifications for events",
    tiers: { starter: true, pro: true, enterprise: true },
  },
  {
    key: "multi_user",
    description: "Team management with role-based access control",
    tiers: { starter: false, pro: true, enterprise: true },
  },
];

export function flagsToTierMatrix(
  flags: FeatureMatrixFlag[],
): Record<FeatureTier, Record<string, boolean>> {
  const matrix: Record<FeatureTier, Record<string, boolean>> = {
    starter: {},
    pro: {},
    enterprise: {},
  };

  for (const flag of flags) {
    for (const tier of TIERS) {
      matrix[tier][flag.key] = !!flag.tiers[tier];
    }
  }

  return matrix;
}

export function tierMatrixToFlags(
  matrix: Partial<Record<FeatureTier, Record<string, boolean | string | number>>>,
): FeatureMatrixFlag[] {
  const keys = new Set<string>();
  for (const tier of TIERS) {
    for (const key of Object.keys(matrix[tier] || {})) {
      keys.add(key);
    }
  }

  // Preserve default ordering/descriptions first, append unknown flags.
  const defaultByKey = new Map(DEFAULT_FLAGS.map((flag) => [flag.key, flag]));
  const orderedKeys = [
    ...DEFAULT_FLAGS.map((flag) => flag.key),
    ...Array.from(keys).filter((key) => !defaultByKey.has(key)),
  ];

  return orderedKeys.map((key) => {
    const base = defaultByKey.get(key);
    return {
      key,
      description: base?.description || key.replaceAll("_", " "),
      tiers: {
        starter: matrix.starter?.[key] === true,
        pro: matrix.pro?.[key] === true,
        enterprise: matrix.enterprise?.[key] === true,
      },
    };
  });
}
