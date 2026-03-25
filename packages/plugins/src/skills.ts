/**
 * Skills loading system with 3-tier hierarchy: bundled > managed > workspace.
 *
 * Skills are markdown files with YAML frontmatter containing a SkillManifest.
 * The markdown body becomes the system prompt.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, getDataDir } from "@nexus/core";
import { SkillManifestSchema } from "./types.js";
import type { SkillDefinition } from "./types.js";

const log = createLogger("plugins:skills");

// ---------------------------------------------------------------------------
// In-memory skill registry
// ---------------------------------------------------------------------------

const skillRegistry = new Map<string, SkillDefinition>();

// ---------------------------------------------------------------------------
// YAML frontmatter parser (minimal — avoids external dependency)
// ---------------------------------------------------------------------------

interface ParsedSkillFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseSkillFile(content: string): ParsedSkillFile {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(fmRegex);
  if (!match) {
    throw new Error("Skill file must start with YAML frontmatter (--- delimiters)");
  }
  const yamlBlock = match[1];
  const body = match[2].trim();
  const frontmatter = parseSimpleYaml(yamlBlock);
  return { frontmatter, body };
}

/**
 * Minimal YAML parser supporting string, number, boolean, and string arrays.
 * Sufficient for skill frontmatter — not a general-purpose YAML parser.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);
  let currentKey = "";
  let currentArray: string[] | null = null;

  for (const line of lines) {
    // Array item line
    const arrayMatch = line.match(/^\s+-\s+"?([^"]*)"?\s*$/);
    if (arrayMatch && currentArray !== null) {
      currentArray.push(arrayMatch[1]);
      continue;
    }

    // Flush previous array
    if (currentArray !== null) {
      result[currentKey] = currentArray;
      currentArray = null;
    }

    // Key-value line
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();

    if (rawValue === "" || rawValue === "[]") {
      // Could be start of an array block or empty value
      if (rawValue === "[]") {
        result[key] = [];
      } else {
        currentKey = key;
        currentArray = [];
      }
      continue;
    }

    // Strip quotes
    const unquoted = rawValue.replace(/^["']|["']$/g, "");
    if (rawValue === "true") {
      result[key] = true;
    } else if (rawValue === "false") {
      result[key] = false;
    } else if (/^\d+$/.test(rawValue)) {
      result[key] = Number(rawValue);
    } else {
      result[key] = unquoted;
    }
  }

  // Flush trailing array
  if (currentArray !== null) {
    result[currentKey] = currentArray;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

function getBundledSkillsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "bundled-skills");
}

function getManagedSkillsDir(): string {
  const dir = path.join(getDataDir(), "skills");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getWorkspaceSkillsDir(): string {
  return path.join(process.cwd(), "nexus-skills");
}

// ---------------------------------------------------------------------------
// Loading helpers
// ---------------------------------------------------------------------------

function loadSkillFromFile(filePath: string): SkillDefinition {
  const content = fs.readFileSync(filePath, "utf8");
  const { frontmatter, body } = parseSkillFile(content);

  const parsed = SkillManifestSchema.safeParse(frontmatter);
  if (!parsed.success) {
    throw new Error(`Invalid skill manifest in ${filePath}: ${parsed.error.message}`);
  }

  const manifest = parsed.data;
  const tools = Array.isArray(frontmatter["tools"])
    ? (frontmatter["tools"] as string[])
    : undefined;
  const maxTurns = typeof frontmatter["maxTurns"] === "number"
    ? frontmatter["maxTurns"]
    : undefined;

  return { manifest, systemPrompt: body, tools, maxTurns };
}

function loadSkillsFromDir(dir: string): SkillDefinition[] {
  if (!fs.existsSync(dir)) return [];

  const skills: SkillDefinition[] = [];
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

  for (const entry of entries) {
    try {
      const skill = loadSkillFromFile(path.join(dir, entry));
      skills.push(skill);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ file: entry, dir, err: msg }, "Failed to load skill file");
    }
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load skills from all 3 tiers. Workspace skills override managed,
 * which override bundled skills with the same id.
 */
export function loadSkills(): SkillDefinition[] {
  skillRegistry.clear();

  // Tier 3 (lowest priority): bundled
  const bundled = loadSkillsFromDir(getBundledSkillsDir());
  for (const s of bundled) {
    s.source = "bundled";
    skillRegistry.set(s.manifest.id, s);
  }

  // Tier 2: managed (~/.nexus/skills/)
  const managed = loadSkillsFromDir(getManagedSkillsDir());
  for (const s of managed) {
    s.source = "managed";
    skillRegistry.set(s.manifest.id, s);
  }

  // Tier 1 (highest priority): workspace
  const workspace = loadSkillsFromDir(getWorkspaceSkillsDir());
  for (const s of workspace) {
    s.source = "workspace";
    skillRegistry.set(s.manifest.id, s);
  }

  const total = skillRegistry.size;
  log.info(
    { total, bundled: bundled.length, managed: managed.length, workspace: workspace.length },
    "Skills loaded",
  );

  return Array.from(skillRegistry.values());
}

/** Get a skill by id from the registry. */
export function getSkill(id: string): SkillDefinition | undefined {
  return skillRegistry.get(id);
}

/** List all loaded skills. */
export function listSkills(): SkillDefinition[] {
  return Array.from(skillRegistry.values());
}

/**
 * Install a skill file into the managed skills directory.
 * Validates the file content before writing.
 */
export function installSkill(filename: string, content: string): SkillDefinition {
  const { frontmatter, body } = parseSkillFile(content);
  const parsed = SkillManifestSchema.safeParse(frontmatter);
  if (!parsed.success) {
    throw new Error(`Invalid skill manifest: ${parsed.error.message}`);
  }

  const managedDir = getManagedSkillsDir();
  const safeName = path.basename(filename);
  if (!safeName || !safeName.endsWith(".md")) {
    throw new Error(`Invalid skill filename: ${filename}`);
  }
  const destPath = path.join(managedDir, safeName);
  if (!destPath.startsWith(managedDir)) {
    throw new Error("Invalid skill path — directory traversal detected");
  }
  fs.writeFileSync(destPath, content, "utf8");

  const skill: SkillDefinition = {
    manifest: parsed.data,
    systemPrompt: body,
    tools: Array.isArray(frontmatter["tools"]) ? (frontmatter["tools"] as string[]) : undefined,
    maxTurns: typeof frontmatter["maxTurns"] === "number" ? frontmatter["maxTurns"] : undefined,
  };

  skillRegistry.set(skill.manifest.id, skill);
  log.info({ skillId: skill.manifest.id, path: destPath }, "Skill installed");
  return skill;
}

/** Export for testing. */
export { parseSkillFile, getManagedSkillsDir };
