// ============================================================
//  ArcenAgent — Unit Tests
//  Tests constructor, address generation, EIP-712 constants
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { ArcenAgent } from "../src/agent";

// Use a deterministic test private key (DO NOT use in production)
const TEST_PRIVATE_KEY =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("ArcenAgent", () => {
    describe("constructor", () => {
        it("should initialize with valid config", () => {
            const agent = new ArcenAgent({
                privateKey: TEST_PRIVATE_KEY,
                rpcUrl: "http://localhost:8545",
                chainId: 11155111,
            });

            expect(agent).toBeDefined();
        });

        it("should accept maxAutoApprove config", () => {
            const agent = new ArcenAgent({
                privateKey: TEST_PRIVATE_KEY,
                rpcUrl: "http://localhost:8545",
                chainId: 11155111,
                maxAutoApprove: "0.01",
            });

            expect(agent).toBeDefined();
        });

        it("should work with different chain IDs", () => {
            const agent = new ArcenAgent({
                privateKey: TEST_PRIVATE_KEY,
                rpcUrl: "https://sepolia.base.org",
                chainId: 84532,
            });

            expect(agent).toBeDefined();
        });
    });

    describe("address", () => {
        it("should return a valid Ethereum address", () => {
            const agent = new ArcenAgent({
                privateKey: TEST_PRIVATE_KEY,
                rpcUrl: "http://localhost:8545",
                chainId: 11155111,
            });

            // address is a getter, not a method
            const addr = agent.address;
            expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/);
        });

        it("should be deterministic for the same private key", () => {
            const agent1 = new ArcenAgent({
                privateKey: TEST_PRIVATE_KEY,
                rpcUrl: "http://localhost:8545",
                chainId: 11155111,
            });

            const agent2 = new ArcenAgent({
                privateKey: TEST_PRIVATE_KEY,
                rpcUrl: "http://localhost:8545",
                chainId: 11155111,
            });

            expect(agent1.address).toBe(agent2.address);
        });

        it("should produce the known address for Hardhat account #0", () => {
            const agent = new ArcenAgent({
                privateKey: TEST_PRIVATE_KEY,
                rpcUrl: "http://localhost:8545",
                chainId: 11155111,
            });

            // This is the well-known address for Hardhat's first account
            expect(agent.address.toLowerCase()).toBe(
                "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            );
        });
    });

    describe("fetch", () => {
        it("should make a normal request when no x402 challenge is received", async () => {
            const agent = new ArcenAgent({
                privateKey: TEST_PRIVATE_KEY,
                rpcUrl: "http://localhost:8545",
                chainId: 11155111,
            });

            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ data: "test" }),
                headers: new Headers(),
            });
            vi.stubGlobal("fetch", fetchSpy);

            const response = await agent.fetch("https://api.example.com/free/data");
            expect(response.status).toBe(200);
            expect(fetchSpy).toHaveBeenCalledOnce();

            vi.unstubAllGlobals();
        });
    });
});
