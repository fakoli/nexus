/**
 * Provider resolver — selects and authenticates a provider with failover.
 *
 * Replaces OpenClaw's auth profile rotation scattered across run.ts/attempt.ts.
 * Key improvement: single file, <150 LOC, clear failover chain.
 */
import { createLogger, retrieveCredential, getAllConfig, getAgent, recordAudit } from "@nexus/core";
import type { Provider } from "./base.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";
import { createGoogleProvider } from "./google.js";
import { createGroqProvider } from "./groq.js";

const log = createLogger("agent:resolver");

interface ResolvedProvider {
  provider: Provider;
  model: string;
}

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 60_000;

function isCoolingDown(providerId: string): boolean {
  const until = cooldowns.get(providerId);
  if (!until) return false;
  if (Date.now() > until) {
    cooldowns.delete(providerId);
    return false;
  }
  return true;
}

export function markProviderFailed(providerId: string): void {
  cooldowns.set(providerId, Date.now() + COOLDOWN_MS);
  log.warn({ providerId, cooldownMs: COOLDOWN_MS }, "Provider marked as failed");
  recordAudit("provider_failed", "system", { providerId });
}

export function resolveProvider(
  providerOverride?: string,
  modelOverride?: string,
  agentId?: string,
): ResolvedProvider {
  const config = getAllConfig();

  // Per-agent config overrides global defaults when no explicit override is given
  let agentProvider: string | undefined;
  let agentModel: string | undefined;
  if (agentId) {
    const agent = getAgent(agentId);
    if (agent) {
      agentProvider = typeof agent.config.provider === "string" ? agent.config.provider : undefined;
      agentModel = typeof agent.config.model === "string" ? agent.config.model : undefined;
    }
  }

  const targetProvider = providerOverride ?? agentProvider ?? config.agent.defaultProvider;
  const targetModel = modelOverride ?? agentModel ?? config.agent.defaultModel;

  const chain = buildProviderChain(targetProvider);

  for (const candidate of chain) {
    if (isCoolingDown(candidate.id)) {
      log.info({ providerId: candidate.id }, "Skipping (cooling down)");
      continue;
    }
    return { provider: candidate, model: targetModel };
  }

  throw new Error(`No available provider (all in cooldown). Tried: ${chain.map((p) => p.id).join(", ")}`);
}

type ProviderFactory = (key: string) => Provider;

const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  anthropic: createAnthropicProvider,
  openai: createOpenAIProvider,
  google: createGoogleProvider,
  groq: createGroqProvider,
};

function buildProviderChain(preferred: string): Provider[] {
  const providers: Provider[] = [];

  // Preferred provider goes first if it has a key
  const preferredKey = getApiKey(preferred);
  const preferredFactory = PROVIDER_FACTORIES[preferred];
  if (preferredKey && preferredFactory) {
    providers.push(preferredFactory(preferredKey));
  }

  // All other providers as fallbacks (in a stable order)
  for (const [id, factory] of Object.entries(PROVIDER_FACTORIES)) {
    if (id === preferred) continue;
    const key = getApiKey(id);
    if (key) providers.push(factory(key));
  }

  return providers;
}

function getApiKey(provider: string): string | null {
  // Try encrypted vault first, then env vars
  const fromVault = retrieveCredential(`${provider}_api_key`);
  if (fromVault) return fromVault;

  const envMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
  };
  return process.env[envMap[provider] ?? ""] ?? null;
}
