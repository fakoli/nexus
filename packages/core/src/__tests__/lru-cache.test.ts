import { describe, it, expect } from "vitest";
import { LRUCache } from "../lru-cache.js";

describe("LRUCache", () => {
  describe("constructor", () => {
    it("creates an empty cache", () => {
      const cache = new LRUCache<string, number>(10);
      expect(cache.size).toBe(0);
    });

    it("throws for maxSize < 1", () => {
      expect(() => new LRUCache<string, number>(0)).toThrow(RangeError);
      expect(() => new LRUCache<string, number>(-1)).toThrow(RangeError);
    });

    it("accepts maxSize of 1", () => {
      const cache = new LRUCache<string, number>(1);
      expect(cache.size).toBe(0);
    });
  });

  describe("set and get", () => {
    it("stores and retrieves a value", () => {
      const cache = new LRUCache<string, string>(5);
      cache.set("a", "alpha");
      expect(cache.get("a")).toBe("alpha");
    });

    it("returns undefined for missing key", () => {
      const cache = new LRUCache<string, number>(5);
      expect(cache.get("missing")).toBeUndefined();
    });

    it("updates existing key", () => {
      const cache = new LRUCache<string, number>(5);
      cache.set("x", 1);
      cache.set("x", 2);
      expect(cache.get("x")).toBe(2);
      expect(cache.size).toBe(1);
    });
  });

  describe("has", () => {
    it("returns true for existing key", () => {
      const cache = new LRUCache<string, number>(5);
      cache.set("k", 42);
      expect(cache.has("k")).toBe(true);
    });

    it("returns false for missing key", () => {
      const cache = new LRUCache<string, number>(5);
      expect(cache.has("k")).toBe(false);
    });
  });

  describe("delete", () => {
    it("removes an existing key and returns true", () => {
      const cache = new LRUCache<string, number>(5);
      cache.set("del", 99);
      expect(cache.delete("del")).toBe(true);
      expect(cache.has("del")).toBe(false);
      expect(cache.size).toBe(0);
    });

    it("returns false for non-existent key", () => {
      const cache = new LRUCache<string, number>(5);
      expect(cache.delete("nope")).toBe(false);
    });
  });

  describe("clear", () => {
    it("empties the cache", () => {
      const cache = new LRUCache<string, number>(5);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.has("a")).toBe(false);
    });
  });

  describe("LRU eviction", () => {
    it("evicts the oldest entry when at capacity", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Cache is full: a, b, c
      cache.set("d", 4);
      // "a" should have been evicted (oldest)
      expect(cache.has("a")).toBe(false);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
      expect(cache.size).toBe(3);
    });

    it("promotes accessed entry so it is not the next to be evicted", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Access "a" to make it most recently used.
      cache.get("a");
      // Now add "d" — "b" is now the oldest, not "a"
      cache.set("d", 4);
      expect(cache.has("b")).toBe(false);
      expect(cache.has("a")).toBe(true);
    });

    it("updating existing key moves it to most recently used", () => {
      const cache = new LRUCache<string, number>(3);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      // Update "a" (moves it to end, making "b" oldest).
      cache.set("a", 10);
      cache.set("d", 4);
      // "b" should be evicted
      expect(cache.has("b")).toBe(false);
      expect(cache.get("a")).toBe(10);
    });

    it("maxSize of 1 always evicts the previous entry", () => {
      const cache = new LRUCache<string, number>(1);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.has("a")).toBe(false);
      expect(cache.get("b")).toBe(2);
      expect(cache.size).toBe(1);
    });
  });

  describe("size", () => {
    it("tracks insertions and deletions correctly", () => {
      const cache = new LRUCache<string, number>(10);
      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.size).toBe(2);
      cache.delete("a");
      expect(cache.size).toBe(1);
    });

    it("does not exceed maxSize", () => {
      const maxSize = 5;
      const cache = new LRUCache<number, number>(maxSize);
      for (let i = 0; i < 20; i++) {
        cache.set(i, i);
      }
      expect(cache.size).toBe(maxSize);
    });
  });
});
