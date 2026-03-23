import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), "nexus-path-guard-test-"));
}

describe("path-guard: resolveSafePath", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("allows a path inside the root", async () => {
    const { resolveSafePath } = await import("../security/path-guard.js");
    const { realpathSync } = await import("fs");
    const filePath = path.join(root, "file.txt");
    writeFileSync(filePath, "hello");
    const result = resolveSafePath(filePath, [root]);
    expect(result).not.toBeNull();
    // realpathSync resolves macOS /var -> /private/var; compare canonical forms
    expect(result).toBe(realpathSync(filePath));
  });

  it("denies a path outside all roots", async () => {
    const { resolveSafePath } = await import("../security/path-guard.js");
    const result = resolveSafePath("/etc/passwd", [root]);
    expect(result).toBeNull();
  });

  it("denies traversal attempts (../../etc)", async () => {
    const { resolveSafePath } = await import("../security/path-guard.js");
    const traversal = path.join(root, "sub", "..", "..", "etc", "passwd");
    const result = resolveSafePath(traversal, [root]);
    expect(result).toBeNull();
  });

  it("returns null for relative paths", async () => {
    const { resolveSafePath } = await import("../security/path-guard.js");
    const result = resolveSafePath("relative/path", [root]);
    expect(result).toBeNull();
  });

  it("returns null when no allowed roots provided", async () => {
    const { resolveSafePath } = await import("../security/path-guard.js");
    const result = resolveSafePath(path.join(root, "file.txt"), []);
    expect(result).toBeNull();
  });

  it("allows root itself", async () => {
    const { resolveSafePath } = await import("../security/path-guard.js");
    const result = resolveSafePath(root, [root]);
    expect(result).not.toBeNull();
  });

  it("allows a path under one of multiple roots", async () => {
    const { resolveSafePath } = await import("../security/path-guard.js");
    const otherRoot = makeTmpDir();
    try {
      const filePath = path.join(root, "file.txt");
      writeFileSync(filePath, "data");
      const result = resolveSafePath(filePath, [otherRoot, root]);
      expect(result).not.toBeNull();
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("resolves non-existent path correctly inside root", async () => {
    const { resolveSafePath } = await import("../security/path-guard.js");
    const notYetExisting = path.join(root, "new", "file.txt");
    // The file does not exist but the parent (root) does
    const result = resolveSafePath(notYetExisting, [root]);
    expect(result).not.toBeNull();
  });
});

describe("path-guard: detectSymlinkEscape", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = makeTmpDir();
    outside = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("returns false for a regular file", async () => {
    const { detectSymlinkEscape } = await import("../security/path-guard.js");
    const filePath = path.join(root, "plain.txt");
    writeFileSync(filePath, "data");
    expect(detectSymlinkEscape(filePath, root)).toBe(false);
  });

  it("returns false for non-existent path", async () => {
    const { detectSymlinkEscape } = await import("../security/path-guard.js");
    expect(detectSymlinkEscape(path.join(root, "ghost.txt"), root)).toBe(false);
  });

  it("returns false for symlink pointing inside root", async () => {
    const { detectSymlinkEscape } = await import("../security/path-guard.js");
    const target = path.join(root, "target.txt");
    writeFileSync(target, "hello");
    const link = path.join(root, "link.txt");
    symlinkSync(target, link);
    expect(detectSymlinkEscape(link, root)).toBe(false);
  });

  it("returns true for symlink pointing outside root", async () => {
    const { detectSymlinkEscape } = await import("../security/path-guard.js");
    const target = path.join(outside, "secret.txt");
    writeFileSync(target, "secret");
    const link = path.join(root, "escape-link.txt");
    symlinkSync(target, link);
    expect(detectSymlinkEscape(link, root)).toBe(true);
  });

  it("returns false for directory symlink pointing inside root", async () => {
    const { detectSymlinkEscape } = await import("../security/path-guard.js");
    const subDir = path.join(root, "sub");
    mkdirSync(subDir);
    const link = path.join(root, "link-dir");
    symlinkSync(subDir, link);
    expect(detectSymlinkEscape(link, root)).toBe(false);
  });
});
