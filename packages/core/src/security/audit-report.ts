/**
 * Security audit report generator.
 *
 * Runs a set of named checks against the current runtime configuration
 * and returns a scored report suitable for display or automated gates.
 */
import fs from "node:fs";
import path from "node:path";
import { getAllConfig } from "../config.js";
import { queryAudit } from "../audit.js";
import { listAgents } from "../agents.js";
import { getDataDir } from "../db.js";

export interface AuditCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface AuditReport {
  checks: AuditCheck[];
  score: number;
  summary: string;
}

// ── Individual checks ──────────────────────────────────────────────────────

function checkPromptGuard(): AuditCheck {
  const cfg = getAllConfig();
  const pg = cfg.security.promptGuard;
  if (pg === "enforce") {
    return { name: "prompt_guard", status: "pass", detail: "Prompt guard is set to enforce." };
  }
  if (pg === "warn") {
    return { name: "prompt_guard", status: "warn", detail: "Prompt guard is set to warn — injections are logged but not blocked." };
  }
  return { name: "prompt_guard", status: "fail", detail: "Prompt guard is disabled (off) — injections will not be detected." };
}

function checkWorkspaceRoots(): AuditCheck {
  const cfg = getAllConfig();
  const roots = cfg.security.workspaceRoots;
  if (roots.length > 0) {
    return { name: "workspace_roots", status: "pass", detail: `${roots.length} workspace root(s) configured.` };
  }
  return {
    name: "workspace_roots",
    status: "warn",
    detail: "No workspace roots configured — path-guard will use the process working directory as fallback.",
  };
}

function checkToolPolicies(): AuditCheck {
  const agents = listAgents();
  if (agents.length === 0) {
    return { name: "tool_policies", status: "warn", detail: "No agents found — no tool policies to evaluate." };
  }
  const withPolicy = agents.filter((a) => {
    const tp = a.config["toolPolicy"];
    if (!tp || typeof tp !== "object") return false;
    const p = tp as Record<string, unknown>;
    return (Array.isArray(p["allow"]) && p["allow"].length > 0) ||
           (Array.isArray(p["deny"]) && p["deny"].length > 0);
  });
  if (withPolicy.length > 0) {
    return {
      name: "tool_policies",
      status: "pass",
      detail: `${withPolicy.length} of ${agents.length} agent(s) have explicit tool policies.`,
    };
  }
  return {
    name: "tool_policies",
    status: "warn",
    detail: `${agents.length} agent(s) found but none have explicit tool policies — all tools are permitted by default.`,
  };
}

function checkRecentSecurityEvents(): AuditCheck {
  const entries = queryAudit("security:prompt_injection_detected", 50);
  if (entries.length === 0) {
    return { name: "recent_security_events", status: "pass", detail: "No prompt injection events in the last 50 audit entries." };
  }
  return {
    name: "recent_security_events",
    status: "warn",
    detail: `${entries.length} prompt injection event(s) recorded in recent audit log.`,
  };
}

function checkSsrfAllowlist(): AuditCheck {
  const cfg = getAllConfig();
  const list = cfg.security.ssrfAllowlist;
  if (list.length > 0) {
    return {
      name: "ssrf_allowlist",
      status: "pass",
      detail: `SSRF allowlist is configured with ${list.length} pattern(s) — only listed hosts are reachable.`,
    };
  }
  return {
    name: "ssrf_allowlist",
    status: "warn",
    detail: "No SSRF allowlist configured — all public hosts are reachable from web-fetch tools.",
  };
}

function checkMasterKeyPersistence(): AuditCheck {
  const keyPath = path.join(getDataDir(), "master.key");
  if (fs.existsSync(keyPath)) {
    const stat = fs.statSync(keyPath);
    // mode & 0o777 gives permission bits; 0o600 is owner read/write only
    const perms = stat.mode & 0o777;
    if (perms === 0o600) {
      return { name: "master_key", status: "pass", detail: "Master key file exists with correct 0600 permissions." };
    }
    return {
      name: "master_key",
      status: "warn",
      detail: `Master key file exists but has permissions ${(perms).toString(8)} — expected 0600.`,
    };
  }
  if (process.env.NEXUS_MASTER_KEY) {
    return { name: "master_key", status: "pass", detail: "Master key loaded from NEXUS_MASTER_KEY environment variable." };
  }
  return {
    name: "master_key",
    status: "warn",
    detail: "Master key file not yet created — it will be generated on first use of encryption.",
  };
}

// ── Score computation ──────────────────────────────────────────────────────

function computeScore(checks: AuditCheck[]): number {
  if (checks.length === 0) return 0;
  const points = checks.reduce((acc, c) => {
    if (c.status === "pass") return acc + 2;
    if (c.status === "warn") return acc + 1;
    return acc;
  }, 0);
  return Math.round((points / (checks.length * 2)) * 100);
}

function buildSummary(checks: AuditCheck[], score: number): string {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  if (fails > 0) {
    return `Security score ${score}/100 — ${fails} critical issue(s) and ${warns} warning(s) require attention.`;
  }
  if (warns > 0) {
    return `Security score ${score}/100 — ${warns} warning(s) noted; no critical issues.`;
  }
  return `Security score ${score}/100 — all checks passed.`;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function runSecurityAudit(): AuditReport {
  const checks: AuditCheck[] = [
    checkPromptGuard(),
    checkWorkspaceRoots(),
    checkToolPolicies(),
    checkRecentSecurityEvents(),
    checkSsrfAllowlist(),
    checkMasterKeyPersistence(),
  ];
  const score = computeScore(checks);
  const summary = buildSummary(checks, score);
  return { checks, score, summary };
}
