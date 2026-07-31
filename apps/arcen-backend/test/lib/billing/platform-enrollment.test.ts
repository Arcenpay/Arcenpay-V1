import { afterEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: "token-1" }),
}));

vi.mock("../../../src/db.js", () => ({
  db: { embedAccessToken: { create } },
}));

import { issuePlatformBillingEmbedToken } from "../../../src/lib/billing/platform-enrollment.js";

describe("platform billing enrollment token", () => {
  afterEach(() => {
    delete process.env.ACCESS_TOKEN_SECRET;
    create.mockClear();
  });

  it("keeps provider billing scope and workspace projection scope distinct", async () => {
    process.env.ACCESS_TOKEN_SECRET = "test-secret";

    const result = await issuePlatformBillingEmbedToken({
      workspaceTeamId: "workspace-team",
      providerTeamId: "provider-team",
      companyId: "provider-company",
      componentId: "provider-component",
      environmentId: "provider-environment",
    });

    const [, body] = result.token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, string>;
    expect(payload.teamId).toBe("provider-team");
    expect(payload.workspaceTeamId).toBe("workspace-team");
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teamId: "provider-team",
        companyId: "provider-company",
        environmentId: "provider-environment",
      }),
    });
  });
});
