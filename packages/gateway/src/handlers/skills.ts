/**
 * Skill RPC handlers.
 *
 * - skills.list    — list available skills (all tiers)
 * - skills.install — install a skill from ClawhHub
 * - skills.search  — search ClawhHub for skills
 */
import { z } from "zod";
import { createLogger } from "@nexus/core";
import {
  listSkills,
  loadSkills,
  searchClawhubSkills,
  installClawhubSkill,
} from "@nexus/plugins";
import type { ResponseFrame } from "../protocol/frames.js";

const log = createLogger("gateway:skills");

// ---------------------------------------------------------------------------
// Param schemas
// ---------------------------------------------------------------------------

const SkillsSearchParams = z.object({
  query: z.string().default(""),
});

const SkillsInstallParams = z.object({
  skillId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function handleSkillsList(): ResponseFrame {
  // Ensure skills are loaded
  let skills = listSkills();
  if (skills.length === 0) {
    skills = loadSkills();
  }
  const payload = skills.map((s) => ({
    id: s.manifest.id,
    name: s.manifest.name,
    version: s.manifest.version,
    description: s.manifest.description,
    author: s.manifest.author,
    tags: s.manifest.tags,
    triggers: s.manifest.triggers ?? [],
    source: s.source ?? "managed",
  }));
  return { id: "", ok: true, payload: { skills: payload } };
}

export async function handleSkillsInstall(
  params: Record<string, unknown>,
): Promise<ResponseFrame> {
  const parsed = SkillsInstallParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  try {
    await installClawhubSkill(parsed.data.skillId);
    log.info({ skillId: parsed.data.skillId }, "Skill installed from ClawhHub via RPC");
    return {
      id: "",
      ok: true,
      payload: { skillId: parsed.data.skillId },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: "",
      ok: false,
      error: { code: "SKILL_INSTALL_FAILED", message: msg },
    };
  }
}

export async function handleSkillsSearch(
  params: Record<string, unknown>,
): Promise<ResponseFrame> {
  const parsed = SkillsSearchParams.safeParse(params);
  if (!parsed.success) {
    return {
      id: "",
      ok: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    };
  }

  try {
    const results = await searchClawhubSkills(parsed.data.query);
    return {
      id: "",
      ok: true,
      payload: { skills: results },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: "",
      ok: false,
      error: { code: "SKILL_SEARCH_FAILED", message: msg },
    };
  }
}
