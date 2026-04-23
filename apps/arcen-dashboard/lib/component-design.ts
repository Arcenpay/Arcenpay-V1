type UnknownRecord = Record<string, unknown>;

export type NormalizedComponentDesign = {
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  fontSize: string | number;
  cardStyle: "minimal" | "bordered" | "elevated";
  columns: number;
  sections: "merged" | "separate";
  fontColor: string;
  backgroundColor: string;
  borderRadius: string | number;
};

export type NormalizedComponentStyling = {
  columns: number;
  sections: "merged" | "separate";
  primaryColor: string;
  secondaryColor: string;
  cardStyle: {
    backgroundColor: string;
    borderRadius: string;
    cardShadow: boolean;
    cardPadding: string;
  };
  typography: {
    fontFamily: string;
    fontSize: string;
  };
};

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as UnknownRecord;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeCardStyle(
  raw: UnknownRecord,
  cardStyleConfig: UnknownRecord,
): "minimal" | "bordered" | "elevated" {
  const explicitStyle = readString(raw.cardStyle);
  if (
    explicitStyle === "minimal" ||
    explicitStyle === "bordered" ||
    explicitStyle === "elevated"
  ) {
    return explicitStyle;
  }

  if (typeof cardStyleConfig.cardShadow === "boolean") {
    return cardStyleConfig.cardShadow ? "elevated" : "minimal";
  }

  return "minimal";
}

export function normalizeComponentDesign(
  rawInput: UnknownRecord,
): NormalizedComponentDesign {
  const raw = asRecord(rawInput);
  const typography = asRecord(raw.typography);
  const cardStyleConfig = asRecord(raw.cardStyle);

  const fontSize =
    readPositiveNumber(raw.fontSize) ??
    readPositiveNumber(typography.fontSize) ??
    14;
  const borderRadius =
    readString(raw.borderRadius) ??
    readString(cardStyleConfig.borderRadius) ??
    readPositiveNumber(raw.borderRadius) ??
    readPositiveNumber(cardStyleConfig.borderRadius) ??
    8;

  return {
    primaryColor: readString(raw.primaryColor) ?? "#000000",
    secondaryColor: readString(raw.secondaryColor) ?? "#f3f4f6",
    fontFamily:
      readString(raw.fontFamily) ??
      readString(typography.fontFamily) ??
      "system-ui, sans-serif",
    fontSize,
    cardStyle: normalizeCardStyle(raw, cardStyleConfig),
    columns: readPositiveNumber(raw.columns) ?? 1,
    sections: raw.sections === "merged" ? "merged" : "separate",
    fontColor: readString(raw.fontColor) ?? "#111827",
    backgroundColor:
      readString(raw.backgroundColor) ??
      readString(cardStyleConfig.backgroundColor) ??
      "#ffffff",
    borderRadius,
  };
}

export function normalizeComponentStyling(
  rawInput: UnknownRecord,
): NormalizedComponentStyling {
  const raw = asRecord(rawInput);
  const typography = asRecord(raw.typography);
  const cardStyleConfig = asRecord(raw.cardStyle);
  const design = normalizeComponentDesign(raw);
  const borderRadius =
    readString(cardStyleConfig.borderRadius) ??
    readString(raw.borderRadius) ??
    `${design.borderRadius}px`;

  return {
    columns: design.columns,
    sections: design.sections,
    primaryColor: design.primaryColor,
    secondaryColor: design.secondaryColor,
    cardStyle: {
      backgroundColor: design.backgroundColor,
      borderRadius,
      cardShadow:
        design.cardStyle === "elevated" ||
        cardStyleConfig.cardShadow === true,
      cardPadding: readString(cardStyleConfig.cardPadding) ?? "24px",
    },
    typography: {
      fontFamily: design.fontFamily,
      fontSize:
        readString(typography.fontSize) ??
        readString(raw.fontSize) ??
        `${design.fontSize}px`,
    },
  };
}
