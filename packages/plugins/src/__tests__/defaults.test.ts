import { describe, it, expect } from "vitest";
import { DEFAULT_REGISTRIES, CLAWHUB_DEFAULT_URL } from "../defaults.js";

describe("defaults", () => {
  it("DEFAULT_REGISTRIES contains fakoli/fakoli-plugins", () => {
    expect(DEFAULT_REGISTRIES).toContain(
      "https://github.com/fakoli/fakoli-plugins",
    );
  });

  it("DEFAULT_REGISTRIES is an array with at least one entry", () => {
    expect(Array.isArray(DEFAULT_REGISTRIES)).toBe(true);
    expect(DEFAULT_REGISTRIES.length).toBeGreaterThanOrEqual(1);
  });

  it("CLAWHUB_DEFAULT_URL points to clawhub.dev API v1", () => {
    expect(CLAWHUB_DEFAULT_URL).toBe("https://clawhub.dev/api/v1");
  });
});
