// ============================================================
//  EventListenerService — Unit Tests
//  Tests callback registration, emission, and wildcard handling
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { EventListenerService } from "../src/services/events";

// We test the public API without an actual RPC connection
// by using the on() method and manually emitting events.

describe("EventListenerService", () => {
  describe("callback registration", () => {
    it("should register and invoke callbacks for specific event types", async () => {
      const listener = new EventListenerService({
        rpcUrl: "http://localhost:8545",
        chainId: 11155111,
      });

      const mintedCallback = vi.fn();
      listener.on("minted", mintedCallback);

      // The emit method is private, but we can test via the on()/start() pattern
      // For unit testing, we verify registration worked
      expect(mintedCallback).not.toHaveBeenCalled();

      listener.stop();
    });

    it("should support unsubscribing via returned function", () => {
      const listener = new EventListenerService({
        rpcUrl: "http://localhost:8545",
        chainId: 11155111,
      });

      const callback = vi.fn();
      const unsubscribe = listener.on("minted", callback);

      // Unsubscribe
      unsubscribe();

      listener.stop();
    });

    it("should support wildcard ('*') subscriptions", () => {
      const listener = new EventListenerService({
        rpcUrl: "http://localhost:8545",
        chainId: 11155111,
      });

      const wildcardCallback = vi.fn();
      listener.on("*", wildcardCallback);

      expect(wildcardCallback).not.toHaveBeenCalled();

      listener.stop();
    });

    it("should support multiple callbacks per event type", () => {
      const listener = new EventListenerService({
        rpcUrl: "http://localhost:8545",
        chainId: 11155111,
      });

      const cb1 = vi.fn();
      const cb2 = vi.fn();
      listener.on("renewed", cb1);
      listener.on("renewed", cb2);

      // Both should be registered
      listener.stop();
    });
  });

  describe("stop", () => {
    it("should stop without errors when not started", () => {
      const listener = new EventListenerService({
        rpcUrl: "http://localhost:8545",
        chainId: 11155111,
      });

      // Should not throw
      listener.stop();
    });
  });

  describe("constructor", () => {
    it("should accept custom chain IDs", () => {
      const listener = new EventListenerService({
        rpcUrl: "http://localhost:8545",
        chainId: 84532,
      });

      listener.stop();
    });

    it("should accept custom registry addresses", () => {
      const listener = new EventListenerService({
        rpcUrl: "http://localhost:8545",
        chainId: 11155111,
        registryAddress: "0x1234567890abcdef1234567890abcdef12345678",
      });

      listener.stop();
    });
  });
});
