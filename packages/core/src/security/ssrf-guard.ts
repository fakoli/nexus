export interface ValidationResult {
  safe: boolean;
  reason?: string;
}

// Blocked hostnames (exact and suffix)
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  // 169.254.169.254 is caught by the link-local CIDR block below
]);

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localdomain"];

// Parses an IPv4 string to a 32-bit integer; returns null if not valid IPv4
function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let val = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255 || part === "") return null;
    val = (val << 8) | n;
  }
  return val >>> 0;
}

// Check if an IPv4 integer falls in a CIDR block
function inCIDR(ip: number, base: number, mask: number): boolean {
  const maskBits = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
  return (ip & maskBits) === (base & maskBits);
}

const BLOCKED_IPV4_CIDRS: Array<{ base: number; mask: number; label: string }> = [
  { base: parseIPv4("10.0.0.0") as number,      mask: 8,  label: "RFC1918 10/8" },
  { base: parseIPv4("172.16.0.0") as number,    mask: 12, label: "RFC1918 172.16/12" },
  { base: parseIPv4("192.168.0.0") as number,   mask: 16, label: "RFC1918 192.168/16" },
  { base: parseIPv4("127.0.0.0") as number,     mask: 8,  label: "loopback 127/8" },
  { base: parseIPv4("169.254.0.0") as number,   mask: 16, label: "link-local 169.254/16" },
  { base: parseIPv4("224.0.0.0") as number,     mask: 4,  label: "multicast 224/4" },
  { base: parseIPv4("0.0.0.0") as number,       mask: 8,  label: "this-network 0/8" },
];

function isBlockedIPv4(host: string): string | null {
  const ip = parseIPv4(host);
  if (ip === null) return null;
  for (const cidr of BLOCKED_IPV4_CIDRS) {
    if (inCIDR(ip, cidr.base, cidr.mask)) {
      return `IP in blocked range: ${cidr.label}`;
    }
  }
  return null;
}

function isBlockedIPv6(host: string): boolean {
  // Strip brackets if present ([::1])
  const stripped = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  // ::1 loopback and variants
  if (stripped === "::1") return true;
  if (/^::ffff:127\./i.test(stripped)) return true;
  if (/^::ffff:0*7f/i.test(stripped)) return true;
  return false;
}

function matchesWildcard(pattern: string, hostname: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    return hostname === pattern.slice(2) || hostname.endsWith(suffix);
  }
  return pattern === hostname;
}

function isAllowlisted(hostname: string, allowlist: string[]): boolean {
  return allowlist.some((pattern) => matchesWildcard(pattern.toLowerCase(), hostname.toLowerCase()));
}

export function validateUrl(
  url: string,
  allowlist?: string[],
): ValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: `Blocked scheme: ${parsed.protocol}` };
  }

  // hostname strips brackets from IPv6 literals; host includes port
  const hostname = parsed.hostname.toLowerCase();

  // When an allowlist is provided it is exclusive: hostname must match or be blocked.
  if (allowlist && allowlist.length > 0) {
    if (isAllowlisted(hostname, allowlist)) {
      return { safe: true };
    }
    return { safe: false, reason: `Hostname not in allowlist: ${hostname}` };
  }

  // Exact blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: `Blocked hostname: ${hostname}` };
  }

  // Blocked suffixes
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { safe: false, reason: `Blocked hostname suffix: ${suffix}` };
    }
  }

  // IPv4 CIDR checks
  const ipv4Block = isBlockedIPv4(hostname);
  if (ipv4Block !== null) {
    return { safe: false, reason: ipv4Block };
  }

  // IPv6 loopback
  if (isBlockedIPv6(hostname)) {
    return { safe: false, reason: "Blocked IPv6 address (loopback)" };
  }

  return { safe: true };
}
