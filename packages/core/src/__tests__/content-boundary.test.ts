import { describe, it, expect } from "vitest";
import {
  wrapExternalContent,
  sanitizeMarkers,
  extractBoundaryMetadata,
} from "../security/content-boundary.js";

describe("wrapExternalContent", () => {
  it("wraps content with open and close boundary markers", () => {
    const result = wrapExternalContent("https://example.com", "Hello world");
    expect(result).toMatch(/^<<<EXTERNAL_UNTRUSTED_CONTENT /);
    expect(result).toMatch(/<<<END_EXTERNAL_CONTENT>>>$/);
  });

  it("embeds the source attribute in the open tag", () => {
    const result = wrapExternalContent("https://example.com/page", "content");
    expect(result).toContain('source="https://example.com/page"');
  });

  it("generates a unique random hex id on each call", () => {
    const r1 = wrapExternalContent("src", "text");
    const r2 = wrapExternalContent("src", "text");
    const idRe = /id="([a-f0-9]+)"/;
    const id1 = idRe.exec(r1)?.[1];
    const id2 = idRe.exec(r2)?.[1];
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  it("includes extra metadata attributes when provided", () => {
    const result = wrapExternalContent("src", "body", { via: "rss", lang: "en" });
    expect(result).toContain('via="rss"');
    expect(result).toContain('lang="en"');
  });

  it("sanitizes Unicode angle brackets in the content", () => {
    const result = wrapExternalContent("src", "\u27E8script\u27E9evil\u27E9");
    expect(result).toContain("<script>evil>");
    expect(result).not.toContain("\u27E8");
    expect(result).not.toContain("\u27E9");
  });

  it("strips invisible format characters from content", () => {
    const result = wrapExternalContent("src", "Hello\u200BWorld\u202E!");
    expect(result).toContain("HelloWorld!");
    expect(result).not.toContain("\u200B");
    expect(result).not.toContain("\u202E");
  });

  it("escapes double-quotes in source attribute", () => {
    const result = wrapExternalContent('he said "hi"', "body");
    expect(result).toContain('source="he said &quot;hi&quot;"');
  });
});

describe("sanitizeMarkers", () => {
  it("folds U+FF1C/U+FF1E fullwidth angle brackets to ASCII", () => {
    expect(sanitizeMarkers("\uFF1Cfoo\uFF1E")).toBe("<foo>");
  });

  it("folds CJK angle brackets \u3008\u3009 to ASCII", () => {
    expect(sanitizeMarkers("\u3008bar\u3009")).toBe("<bar>");
  });

  it("removes zero-width non-breaking space U+FEFF", () => {
    expect(sanitizeMarkers("hel\uFEFFlo")).toBe("hello");
  });

  it("removes direction-override U+202E", () => {
    expect(sanitizeMarkers("ab\u202Ecd")).toBe("abcd");
  });

  it("leaves normal ASCII text unchanged", () => {
    const input = "Hello <world> & friends";
    expect(sanitizeMarkers(input)).toBe(input);
  });
});

describe("extractBoundaryMetadata", () => {
  it("extracts id and source from a wrapped string", () => {
    const wrapped = wrapExternalContent("https://example.com", "content");
    const meta = extractBoundaryMetadata(wrapped);
    expect(meta).not.toBeNull();
    expect(meta?.source).toBe("https://example.com");
    expect(meta?.id).toMatch(/^[a-f0-9]{16}$/);
  });

  it("returns null for a string without boundary markers", () => {
    expect(extractBoundaryMetadata("plain text")).toBeNull();
  });
});
