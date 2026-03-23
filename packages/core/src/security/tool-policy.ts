/**
 * Tool policy enforcement — allow/deny lists for agent tool access.
 *
 * Each agent's config may carry a `toolPolicy` field:
 *   { allow?: string[], deny?: string[] }
 *
 * Rules:
 *   - Deny takes precedence over allow.
 *   - If allow list is present, tool must match at least one pattern.
 *   - If allow list is absent, all tools are allowed unless denied.
 *   - Pattern matching: "*" matches everything, "bash*" matches any name
 *     starting with "bash", "*_file" matches any name ending with "_file".
 */
import { getAgent } from "../agents.js";
import { createLogger } from "../logger.js";

const log = createLogger("core:security:tool-policy");

export interface ToolPolicy {
  allow?: string[];
  deny?: string[];
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

const ToolPolicySchema = {
  parse(raw: unknown): ToolPolicy {
    if (raw === null || typeof raw !== "object") return {};
    const obj = raw as Record<string, unknown>;
    const result: ToolPolicy = {};
    if (Array.isArray(obj["allow"]) && obj["allow"].every((v) => typeof v === "string")) {
      result.allow = obj["allow"] as string[];
    }
    if (Array.isArray(obj["deny"]) && obj["deny"].every((v) => typeof v === "string")) {
      result.deny = obj["deny"] as string[];
    }
    return result;
  },
};

/**
 * Match a tool name against a glob pattern.
 * Supported wildcards: * (matches any sequence of characters).
 */
export function matchGlob(pattern: string, name: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === name;

  // Escape regex special chars except *, then replace * with .*
  const regexStr =
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*") +
    "$";
  return new RegExp(regexStr).test(name);
}

/**
 * Check whether `toolName` is permitted for `agentId` according to
 * that agent's stored `toolPolicy` config.
 */
export function checkToolPolicy(agentId: string, toolName: string): PolicyResult {
  const agent = getAgent(agentId);
  if (!agent) {
    log.warn({ agentId, toolName }, "Agent not found — defaulting to deny");
    return { allowed: false, reason: `Agent "${agentId}" not found` };
  }

  const rawPolicy = agent.config["toolPolicy"];
  const policy = ToolPolicySchema.parse(rawPolicy ?? {});

  // Deny list takes precedence
  if (policy.deny && policy.deny.length > 0) {
    for (const pattern of policy.deny) {
      if (matchGlob(pattern, toolName)) {
        log.info({ agentId, toolName, pattern }, "Tool denied by deny list");
        return { allowed: false, reason: `Denied by pattern "${pattern}"` };
      }
    }
  }

  // Allow list — if present, tool must match at least one entry
  if (policy.allow && policy.allow.length > 0) {
    for (const pattern of policy.allow) {
      if (matchGlob(pattern, toolName)) {
        log.debug({ agentId, toolName, pattern }, "Tool allowed by allow list");
        return { allowed: true };
      }
    }
    log.info({ agentId, toolName }, "Tool not in allow list");
    return { allowed: false, reason: `"${toolName}" is not in the allow list` };
  }

  // No allow list — permit by default
  return { allowed: true };
}
