/**
 * ClawhHub skills marketplace integration.
 *
 * ClawhHub is a remote skills registry. This module handles searching,
 * fetching details, installing, and syncing skills from the ClawhHub API.
 */
import { z } from "zod";
import { createLogger } from "@nexus/core";
import { CLAWHUB_DEFAULT_URL } from "./defaults.js";
import { installSkill } from "./skills.js";

const log = createLogger("plugins:clawhub");

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ClawhubConfigSchema = z.object({
  enabled: z.boolean().default(false),
  registryUrl: z.string().default(CLAWHUB_DEFAULT_URL),
  apiKey: z.string().optional(),
});

export type ClawhubConfig = z.infer<typeof ClawhubConfigSchema>;

export const ClawhubSkillEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  downloads: z.number().optional(),
  verified: z.boolean().optional(),
});

export type ClawhubSkillEntry = z.infer<typeof ClawhubSkillEntrySchema>;

const ClawhubSearchResponseSchema = z.object({
  skills: z.array(ClawhubSkillEntrySchema),
  total: z.number().optional(),
});

const ClawhubSkillContentSchema = z.object({
  id: z.string(),
  content: z.string(),
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let currentConfig: ClawhubConfig = ClawhubConfigSchema.parse({});

export function configureClawhub(config: Partial<ClawhubConfig>): void {
  const parsed = ClawhubConfigSchema.safeParse({ ...currentConfig, ...config });
  if (!parsed.success) {
    throw new Error(`Invalid ClawhHub config: ${parsed.error.message}`);
  }
  currentConfig = parsed.data;
  log.info({ enabled: currentConfig.enabled }, "ClawhHub configured");
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "nexus-clawhub/1.0",
  };
  if (currentConfig.apiKey) {
    headers["Authorization"] = `Bearer ${currentConfig.apiKey}`;
  }
  return headers;
}

function getBaseUrl(): string {
  return currentConfig.registryUrl.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Search ClawhHub for skills matching a query string. */
export async function searchClawhubSkills(query: string): Promise<ClawhubSkillEntry[]> {
  if (!currentConfig.enabled) {
    log.warn("ClawhHub is not enabled — configure with clawhub.enabled = true");
    return [];
  }

  const url = `${getBaseUrl()}/skills/search?q=${encodeURIComponent(query)}`;
  log.info({ url }, "Searching ClawhHub skills");

  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    throw new Error(`ClawhHub search failed: HTTP ${res.status} ${res.statusText}`);
  }

  const raw: unknown = await res.json();
  const parsed = ClawhubSearchResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ClawhHub search response: ${parsed.error.message}`);
  }

  return parsed.data.skills;
}

/** Get details for a specific skill from ClawhHub. */
export async function getClawhubSkillDetails(skillId: string): Promise<ClawhubSkillEntry> {
  if (!currentConfig.enabled) {
    throw new Error("ClawhHub is not enabled");
  }

  const url = `${getBaseUrl()}/skills/${encodeURIComponent(skillId)}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    throw new Error(`ClawhHub skill fetch failed: HTTP ${res.status} ${res.statusText}`);
  }

  const raw: unknown = await res.json();
  const parsed = ClawhubSkillEntrySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ClawhHub skill response: ${parsed.error.message}`);
  }

  return parsed.data;
}

/** Install a skill from ClawhHub into the managed skills directory. */
export async function installClawhubSkill(skillId: string): Promise<void> {
  if (!currentConfig.enabled) {
    throw new Error("ClawhHub is not enabled");
  }

  const url = `${getBaseUrl()}/skills/${encodeURIComponent(skillId)}/content`;
  log.info({ skillId, url }, "Downloading skill from ClawhHub");

  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    throw new Error(`ClawhHub skill download failed: HTTP ${res.status} ${res.statusText}`);
  }

  const raw: unknown = await res.json();
  const parsed = ClawhubSkillContentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ClawhHub skill content response: ${parsed.error.message}`);
  }

  const filename = `${parsed.data.id}.md`;
  installSkill(filename, parsed.data.content);
  log.info({ skillId }, "Skill installed from ClawhHub");
}

/** Sync installed skills — re-fetch latest versions from ClawhHub. */
export async function syncClawhubSkills(): Promise<void> {
  if (!currentConfig.enabled) {
    log.warn("ClawhHub is not enabled — skipping sync");
    return;
  }

  const url = `${getBaseUrl()}/skills/sync`;
  log.info({ url }, "Syncing skills with ClawhHub");

  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    throw new Error(`ClawhHub sync failed: HTTP ${res.status} ${res.statusText}`);
  }

  log.info("ClawhHub skill sync completed");
}
