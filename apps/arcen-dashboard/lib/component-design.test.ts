import { describe, expect, it } from "vitest";

import {
  normalizeComponentDesign,
  normalizeComponentStyling,
} from "./component-design";

describe("component design normalization", () => {
  it("maps dashboard styling objects into the SDK design shape", () => {
    const normalized = normalizeComponentDesign({
      primaryColor: "#112233",
      secondaryColor: "#f0f0f0",
      typography: {
        fontFamily: "DM Sans",
        fontSize: "16px",
      },
      cardStyle: {
        backgroundColor: "#faf7f2",
        borderRadius: "14px",
        cardShadow: true,
      },
      columns: 3,
      sections: "merged",
    });

    expect(normalized).toMatchObject({
      primaryColor: "#112233",
      secondaryColor: "#f0f0f0",
      fontFamily: "DM Sans",
      fontSize: 16,
      cardStyle: "elevated",
      backgroundColor: "#faf7f2",
      borderRadius: "14px",
      columns: 3,
      sections: "merged",
    });
  });

  it("maps normalized design records back into editor styling", () => {
    const normalized = normalizeComponentStyling({
      primaryColor: "#223344",
      secondaryColor: "#ddeeff",
      fontFamily: "IBM Plex Sans",
      fontSize: 15,
      backgroundColor: "#ffffff",
      borderRadius: 12,
      cardStyle: "bordered",
      columns: 2,
      sections: "separate",
    });

    expect(normalized).toEqual({
      columns: 2,
      sections: "separate",
      primaryColor: "#223344",
      secondaryColor: "#ddeeff",
      cardStyle: {
        backgroundColor: "#ffffff",
        borderRadius: "12px",
        cardShadow: false,
        cardPadding: "24px",
      },
      typography: {
        fontFamily: "IBM Plex Sans",
        fontSize: "15px",
      },
    });
  });
});
