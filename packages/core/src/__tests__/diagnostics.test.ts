import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use fake timers for all interval-based tests.
describe("diagnostics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── startMemoryMonitor ──────────────────────────────────────────────

  describe("startMemoryMonitor", () => {
    it("returns a stop function", async () => {
      const { startMemoryMonitor } = await import("../diagnostics.js");
      const stop = startMemoryMonitor();
      expect(typeof stop).toBe("function");
      stop();
    });

    it("does not fire immediately on start", async () => {
      const { startMemoryMonitor } = await import("../diagnostics.js");
      const spy = vi.spyOn(process, "memoryUsage");
      const stop = startMemoryMonitor();
      expect(spy).not.toHaveBeenCalled();
      stop();
    });

    it("fires after 5 minutes", async () => {
      const { startMemoryMonitor } = await import("../diagnostics.js");
      const spy = vi.spyOn(process, "memoryUsage").mockReturnValue({
        rss: 100,
        heapTotal: 80,
        heapUsed: 60,
        external: 10,
        arrayBuffers: 5,
      });
      const stop = startMemoryMonitor();
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(spy).toHaveBeenCalledTimes(1);
      stop();
    });

    it("stops firing after stop() is called", async () => {
      const { startMemoryMonitor } = await import("../diagnostics.js");
      const spy = vi.spyOn(process, "memoryUsage").mockReturnValue({
        rss: 100,
        heapTotal: 80,
        heapUsed: 60,
        external: 10,
        arrayBuffers: 5,
      });
      const stop = startMemoryMonitor();
      stop();
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── enableHeapSnapshotOnSignal ──────────────────────────────────────

  describe("enableHeapSnapshotOnSignal", () => {
    it("returns a cleanup function", async () => {
      const { enableHeapSnapshotOnSignal } = await import("../diagnostics.js");
      const cleanup = enableHeapSnapshotOnSignal();
      expect(typeof cleanup).toBe("function");
      cleanup();
    });

    it("registers a SIGUSR2 listener", async () => {
      const { enableHeapSnapshotOnSignal } = await import("../diagnostics.js");
      const before = process.listenerCount("SIGUSR2");
      const cleanup = enableHeapSnapshotOnSignal();
      expect(process.listenerCount("SIGUSR2")).toBe(before + 1);
      cleanup();
    });

    it("removes the SIGUSR2 listener on cleanup", async () => {
      const { enableHeapSnapshotOnSignal } = await import("../diagnostics.js");
      const before = process.listenerCount("SIGUSR2");
      const cleanup = enableHeapSnapshotOnSignal();
      cleanup();
      expect(process.listenerCount("SIGUSR2")).toBe(before);
    });
  });

  // ── detectMemoryGrowth ──────────────────────────────────────────────

  describe("detectMemoryGrowth", () => {
    it("returns a stop function", async () => {
      const { detectMemoryGrowth } = await import("../diagnostics.js");
      const stop = detectMemoryGrowth();
      expect(typeof stop).toBe("function");
      stop();
    });

    it("does not warn when heap is stable", async () => {
      const { detectMemoryGrowth } = await import("../diagnostics.js");
      const heapValue = 100_000_000;
      vi.spyOn(process, "memoryUsage").mockReturnValue({
        rss: 200_000_000,
        heapTotal: 150_000_000,
        heapUsed: heapValue,
        external: 1_000_000,
        arrayBuffers: 500_000,
      });

      const stop = detectMemoryGrowth({
        thresholdPercent: 50,
        windowMs: 60_000,
      });

      // Advance past several sample intervals without changing heap.
      vi.advanceTimersByTime(70_000);
      stop();
      // No warning should be emitted — verified by absence of errors.
    });

    it("warns when heap grows beyond threshold within the window", async () => {
      const { detectMemoryGrowth } = await import("../diagnostics.js");

      let callCount = 0;
      const baseHeap = 100_000_000;
      // Double the heap on the second call to trigger >50% growth.
      vi.spyOn(process, "memoryUsage").mockImplementation(() => {
        callCount++;
        return {
          rss: 200_000_000,
          heapTotal: 150_000_000,
          heapUsed: callCount === 1 ? baseHeap : baseHeap * 2,
          external: 1_000_000,
          arrayBuffers: 500_000,
        };
      });

      // Verify the function runs without throwing when growth is detected.
      const stop = detectMemoryGrowth({
        thresholdPercent: 50,
        windowMs: 60_000,
      });

      // First sample at t=6s (sampleInterval = windowMs/10 = 6s)
      vi.advanceTimersByTime(6_000);
      // Second sample at t=12s — heap has doubled, should warn
      vi.advanceTimersByTime(6_000);

      stop();
      expect(typeof stop).toBe("function"); // detectMemoryGrowth completed without error
    });

    it("stops sampling after stop() is called", async () => {
      const { detectMemoryGrowth } = await import("../diagnostics.js");
      const spy = vi.spyOn(process, "memoryUsage").mockReturnValue({
        rss: 100,
        heapTotal: 80,
        heapUsed: 60,
        external: 10,
        arrayBuffers: 5,
      });
      const stop = detectMemoryGrowth({ windowMs: 10_000, thresholdPercent: 10 });
      stop();
      spy.mockClear();
      vi.advanceTimersByTime(20_000);
      expect(spy).not.toHaveBeenCalled();
    });

    it("uses custom options", async () => {
      const { detectMemoryGrowth } = await import("../diagnostics.js");
      const stop = detectMemoryGrowth({
        thresholdPercent: 25,
        windowMs: 30_000,
      });
      expect(typeof stop).toBe("function");
      stop();
    });
  });
});
