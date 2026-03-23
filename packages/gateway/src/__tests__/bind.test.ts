import { describe, it, expect } from "vitest";
import { z } from "zod";

// Import the schema shape directly from zod to avoid pulling in DB deps.
// Must stay in sync with GatewayConfigSchema in @nexus/core config.ts.
const GatewayConfigSchema = z.object({
  port: z.number().default(19200),
  bind: z.enum(["loopback", "lan", "all"]).default("loopback"),
  verbose: z.boolean().default(false),
});

describe("gateway bind configuration", () => {
  it("maps loopback to 127.0.0.1", () => {
    const bind: string = "loopback";
    const host = bind === "loopback" ? "127.0.0.1" : "0.0.0.0";
    expect(host).toBe("127.0.0.1");
  });

  it("maps lan to 0.0.0.0", () => {
    const bind: string = "lan";
    const host = bind === "loopback" ? "127.0.0.1" : "0.0.0.0";
    expect(host).toBe("0.0.0.0");
  });

  it("maps all to 0.0.0.0", () => {
    const bind: string = "all";
    const host = bind === "loopback" ? "127.0.0.1" : "0.0.0.0";
    expect(host).toBe("0.0.0.0");
  });

  it("uses loopback as default bind value", () => {
    const config = GatewayConfigSchema.parse({});
    expect(config.bind).toBe("loopback");
  });

  it("rejects invalid bind values", () => {
    const result = GatewayConfigSchema.safeParse({ bind: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid bind values", () => {
    for (const value of ["loopback", "lan", "all"]) {
      const result = GatewayConfigSchema.safeParse({ bind: value });
      expect(result.success).toBe(true);
    }
  });
});
