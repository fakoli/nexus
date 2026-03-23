import { describe, it, expect } from "vitest";
import { validateUrl } from "../security/ssrf-guard.js";

describe("validateUrl — scheme enforcement", () => {
  it("allows http URLs", () => {
    expect(validateUrl("http://example.com/path").safe).toBe(true);
  });

  it("allows https URLs", () => {
    expect(validateUrl("https://example.com/path").safe).toBe(true);
  });

  it("blocks ftp scheme", () => {
    const r = validateUrl("ftp://example.com/file.txt");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/scheme/i);
  });

  it("blocks file:// scheme", () => {
    const r = validateUrl("file:///etc/passwd");
    expect(r.safe).toBe(false);
  });

  it("returns invalid for a malformed URL", () => {
    const r = validateUrl("not a url");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/invalid url/i);
  });
});

describe("validateUrl — hostname blocks", () => {
  it("blocks localhost", () => {
    const r = validateUrl("http://localhost/api");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/localhost/i);
  });

  it("blocks *.local suffix", () => {
    const r = validateUrl("http://myservice.local/api");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/\.local/);
  });

  it("blocks *.internal suffix", () => {
    const r = validateUrl("https://db.internal/query");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/\.internal/);
  });

  it("blocks metadata.google.internal", () => {
    const r = validateUrl("http://metadata.google.internal/computeMetadata/v1/");
    expect(r.safe).toBe(false);
  });
});

describe("validateUrl — IP range blocks", () => {
  it("blocks 127.0.0.1 (loopback)", () => {
    const r = validateUrl("http://127.0.0.1/");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/loopback/i);
  });

  it("blocks 10.0.0.1 (RFC1918 10/8)", () => {
    const r = validateUrl("http://10.0.0.1/");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/RFC1918/i);
  });

  it("blocks 172.16.0.1 (RFC1918 172.16/12)", () => {
    const r = validateUrl("http://172.16.0.1/");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/RFC1918/i);
  });

  it("blocks 192.168.1.1 (RFC1918 192.168/16)", () => {
    const r = validateUrl("http://192.168.1.1/");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/RFC1918/i);
  });

  it("blocks 169.254.169.254 (link-local / AWS metadata)", () => {
    const r = validateUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/link-local/i);
  });

  it("blocks multicast 224.0.0.1", () => {
    const r = validateUrl("http://224.0.0.1/");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/multicast/i);
  });

  it("blocks IPv6 loopback ::1", () => {
    const r = validateUrl("http://[::1]/api");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/loopback/i);
  });

  it("allows a public IP that is outside blocked ranges", () => {
    expect(validateUrl("https://8.8.8.8/").safe).toBe(true);
  });
});

describe("validateUrl — allowlist", () => {
  it("allows an exact hostname in the allowlist even if it would otherwise be blocked", () => {
    // localhost is normally blocked; allowlisting it should override
    const r = validateUrl("http://localhost/api", ["localhost"]);
    expect(r.safe).toBe(true);
  });

  it("allows a hostname matched by wildcard *.example.com", () => {
    const r = validateUrl("https://sub.example.com/path", ["*.example.com"]);
    expect(r.safe).toBe(true);
  });

  it("does NOT allow a hostname that does not match the wildcard pattern", () => {
    const r = validateUrl("https://evil.com/path", ["*.example.com"]);
    expect(r.safe).toBe(false);
  });

  it("allows the apex domain when allowlist contains *.example.com", () => {
    // "example.com" matches *.example.com because we treat apex as covered
    const r = validateUrl("https://example.com/", ["*.example.com"]);
    expect(r.safe).toBe(true);
  });

  it("blocks when allowlist is present but hostname is not listed", () => {
    const r = validateUrl("https://other.com/", ["*.example.com", "trusted.org"]);
    expect(r.safe).toBe(false);
  });
});
