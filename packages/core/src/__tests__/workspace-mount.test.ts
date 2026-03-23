import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), "nexus-workspace-mount-test-"));
}

describe("workspace-mount: getDefaultMounts", () => {
  it("returns a single writable entry for cwd", async () => {
    const { getDefaultMounts } = await import("../security/workspace-mount.js");
    const mounts = getDefaultMounts();
    expect(mounts).toHaveLength(1);
    expect(mounts[0].writable).toBe(true);
    expect(mounts[0].root).toBe(process.cwd());
  });
});

describe("workspace-mount: checkMountAccess", () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("allows read inside a writable mount", async () => {
    const { checkMountAccess } = await import("../security/workspace-mount.js");
    const filePath = path.join(root, "file.txt");
    writeFileSync(filePath, "data");
    const result = checkMountAccess(filePath, "read", [{ root, writable: true }]);
    expect(result.allowed).toBe(true);
  });

  it("allows write inside a writable mount", async () => {
    const { checkMountAccess } = await import("../security/workspace-mount.js");
    const filePath = path.join(root, "new.txt");
    const result = checkMountAccess(filePath, "write", [{ root, writable: true }]);
    expect(result.allowed).toBe(true);
  });

  it("denies write on a read-only mount", async () => {
    const { checkMountAccess } = await import("../security/workspace-mount.js");
    const filePath = path.join(root, "readonly.txt");
    const result = checkMountAccess(filePath, "write", [{ root, writable: false }]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/read-only/i);
  });

  it("allows read on a read-only mount", async () => {
    const { checkMountAccess } = await import("../security/workspace-mount.js");
    const filePath = path.join(root, "readonly.txt");
    writeFileSync(filePath, "data");
    const result = checkMountAccess(filePath, "read", [{ root, writable: false }]);
    expect(result.allowed).toBe(true);
  });

  it("denies access outside all mounts", async () => {
    const { checkMountAccess } = await import("../security/workspace-mount.js");
    const result = checkMountAccess("/etc/passwd", "read", [{ root, writable: true }]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/outside/i);
  });

  it("denies access with no mounts configured", async () => {
    const { checkMountAccess } = await import("../security/workspace-mount.js");
    const result = checkMountAccess(path.join(root, "file.txt"), "read", []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/no workspace mounts/i);
  });

  it("denies relative path", async () => {
    const { checkMountAccess } = await import("../security/workspace-mount.js");
    const result = checkMountAccess("relative/path.txt", "read", [{ root, writable: true }]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/absolute/i);
  });

  it("returns matching mount in result", async () => {
    const { checkMountAccess } = await import("../security/workspace-mount.js");
    const filePath = path.join(root, "file.txt");
    writeFileSync(filePath, "data");
    const mount = { root, writable: true };
    const result = checkMountAccess(filePath, "read", [mount]);
    expect(result.allowed).toBe(true);
    expect(result.mount).toBeDefined();
    expect(result.mount?.writable).toBe(true);
  });
});
