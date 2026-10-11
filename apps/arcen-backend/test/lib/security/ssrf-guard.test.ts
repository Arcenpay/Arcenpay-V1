import { describe, expect, it } from "vitest";
import { assertSafeOutboundUrl } from "../../../src/lib/security/ssrf-guard.js";

// All cases below use literal IPs / malformed URLs so no DNS lookup happens and
// the result is deterministic offline.
describe("assertSafeOutboundUrl", () => {
  it("rejects non-https schemes", async () => {
    expect((await assertSafeOutboundUrl("http://example.com/")).ok).toBe(false);
    expect((await assertSafeOutboundUrl("ftp://example.com/")).ok).toBe(false);
  });

  it("rejects malformed URLs", async () => {
    expect((await assertSafeOutboundUrl("not a url")).ok).toBe(false);
  });

  it("rejects URLs with embedded credentials", async () => {
    const result = await assertSafeOutboundUrl("https://user:pass@1.1.1.1/");
    expect(result.ok).toBe(false);
  });

  it("rejects non-default ports", async () => {
    expect((await assertSafeOutboundUrl("https://1.1.1.1:8443/")).ok).toBe(false);
  });

  it("blocks cloud metadata and loopback addresses", async () => {
    expect((await assertSafeOutboundUrl("https://169.254.169.254/latest/meta-data/")).ok).toBe(false);
    expect((await assertSafeOutboundUrl("https://127.0.0.1/")).ok).toBe(false);
    expect((await assertSafeOutboundUrl("https://[::1]/")).ok).toBe(false);
  });

  it("blocks private, link-local, CGNAT and reserved ranges", async () => {
    for (const host of [
      "10.0.0.1",
      "10.255.255.255",
      "192.168.1.10",
      "172.16.0.1",
      "172.31.255.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "169.254.1.1",
    ]) {
      const result = await assertSafeOutboundUrl(`https://${host}/`);
      expect(result.ok, `${host} should be blocked`).toBe(false);
    }
  });

  it("blocks IPv6 ULA and link-local", async () => {
    expect((await assertSafeOutboundUrl("https://[fd00::1]/")).ok).toBe(false);
    expect((await assertSafeOutboundUrl("https://[fe80::1]/")).ok).toBe(false);
  });

  it("blocks known-internal hostnames", async () => {
    expect((await assertSafeOutboundUrl("https://localhost/")).ok).toBe(false);
    expect((await assertSafeOutboundUrl("https://metadata.google.internal/")).ok).toBe(false);
    expect((await assertSafeOutboundUrl("https://service.internal/")).ok).toBe(false);
  });

  it("allows a public literal IPv4 on the default port", async () => {
    const result = await assertSafeOutboundUrl("https://1.1.1.1/");
    expect(result.ok).toBe(true);
  });

  it("allows 172.32.x.x (outside the private 172.16/12 block)", async () => {
    expect((await assertSafeOutboundUrl("https://172.32.0.1/")).ok).toBe(true);
  });
});
