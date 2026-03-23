import { describe, it, expect, vi, beforeEach } from "vitest";

// We need fresh module state for each test
describe("logger — setLogLevel and createLogger", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("createLogger returns a logger with default info level", async () => {
    const { createLogger } = await import("../logger.js");
    const log = createLogger("test:default");
    expect(log.level).toBe("info");
  });

  it("createLogger honours explicit level argument", async () => {
    const { createLogger } = await import("../logger.js");
    const log = createLogger("test:explicit", "debug");
    expect(log.level).toBe("debug");
  });

  it("setLogLevel changes level for existing loggers", async () => {
    const { createLogger, setLogLevel } = await import("../logger.js");
    const log1 = createLogger("test:a");
    const log2 = createLogger("test:b");

    expect(log1.level).toBe("info");
    expect(log2.level).toBe("info");

    setLogLevel("debug");

    expect(log1.level).toBe("debug");
    expect(log2.level).toBe("debug");
  });

  it("setLogLevel affects loggers created after the call", async () => {
    const { createLogger, setLogLevel } = await import("../logger.js");
    setLogLevel("warn");
    const log = createLogger("test:after");
    expect(log.level).toBe("warn");
  });

  it("setLogLevel can be called multiple times", async () => {
    const { createLogger, setLogLevel } = await import("../logger.js");
    const log = createLogger("test:multi");

    setLogLevel("debug");
    expect(log.level).toBe("debug");

    setLogLevel("error");
    expect(log.level).toBe("error");

    setLogLevel("info");
    expect(log.level).toBe("info");
  });
});
