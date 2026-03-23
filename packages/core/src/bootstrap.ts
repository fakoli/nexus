/**
 * Bootstrap file management for agent personalization.
 *
 * Bootstrap files (SOUL.md, IDENTITY.md, USER.md, TOOLS.md, AGENTS.md) let
 * operators pre-load agent behaviour at context-build time — similar to
 * OpenClaw's SOUL.md pattern, but per-agent and file-system backed.
 *
 * Layout:
 *   ~/.nexus/bootstrap/<FILE>          — global defaults
 *   ~/.nexus/agents/<agentId>/bootstrap/<FILE> — per-agent overrides
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createLogger } from "./logger.js";

const log = createLogger("core:bootstrap");

export const BOOTSTRAP_FILES = [
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "AGENTS.md",
] as const;

export type BootstrapFileName = (typeof BOOTSTRAP_FILES)[number];

/** Returns the bootstrap directory for global defaults or a specific agent. */
export function getBootstrapDir(agentId?: string): string {
  const base = process.env.NEXUS_HOME ?? path.join(os.homedir(), ".nexus");
  if (agentId) {
    return path.join(base, "agents", agentId, "bootstrap");
  }
  return path.join(base, "bootstrap");
}

/**
 * Reads a bootstrap file. Returns null if the file does not exist.
 * Searches the per-agent dir first; falls back to the global dir when agentId
 * is provided but no agent-specific file exists.
 */
export function getBootstrapFile(name: string, agentId?: string): string | null {
  const candidates: string[] = [];

  if (agentId) {
    candidates.push(path.join(getBootstrapDir(agentId), name));
  }
  candidates.push(path.join(getBootstrapDir(), name));

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        log.debug({ filePath }, "Bootstrap file loaded");
        return content;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ filePath, err: msg }, "Failed to read bootstrap file");
    }
  }

  return null;
}

/** Writes (or overwrites) a bootstrap file. Creates parent directories as needed. */
export function setBootstrapFile(name: string, content: string, agentId?: string): void {
  const dir = getBootstrapDir(agentId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf8");
  log.info({ filePath }, "Bootstrap file written");
}

/**
 * Lists all bootstrap files that currently exist on disk.
 * Checks the per-agent dir first, then the global dir; returns unique names.
 */
export function listBootstrapFiles(agentId?: string): string[] {
  const found = new Set<string>();

  const dirs: string[] = [];
  if (agentId) dirs.push(getBootstrapDir(agentId));
  dirs.push(getBootstrapDir());

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        found.add(entry);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ dir, err: msg }, "Failed to list bootstrap directory");
    }
  }

  return Array.from(found);
}

/**
 * Concatenates all present bootstrap files (in canonical order) into a single
 * string suitable for prepending to a system prompt.
 */
export function loadBootstrapContent(agentId?: string): string {
  const parts: string[] = [];

  for (const name of BOOTSTRAP_FILES) {
    const content = getBootstrapFile(name, agentId);
    if (content) {
      parts.push(content.trim());
    }
  }

  return parts.join("\n\n");
}
