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
import { createDeepSeekProvider } from "./deepseek.js";
import { createOllamaProvider } from "./ollama.js";
import { createOpenRouterProvider } from "./openrouter.js";

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
  deepseek: createDeepSeekProvider,
  // Ollama: local provider — no key required; wrap in a factory signature for
  // consistency with the chain builder.
  ollama: (_key: string) => createOllamaProvider({ apiKey: _key }),
  openrouter: createOpenRouterProvider,
};

function buildProviderChain(preferred: string): Provider[] {
  const providers: Provider[] = [];

  // Preferred provider goes first.  For Ollama (local, no key required) we
  // always include it when it is explicitly requested.
  const preferredKey = getApiKey(preferred, true);
  const preferredFactory = PROVIDER_FACTORIES[preferred];
  if (preferredKey && preferredFactory) {
    providers.push(preferredFactory(preferredKey));
  }

  // All other providers as fallbacks (in a stable order).  Ollama only
  // appears as a fallback when OLLAMA_API_KEY is explicitly set — this
  // prevents it from silently shadowing missing-key errors in tests and
  // production environments that don't have Ollama running.
  for (const [id, factory] of Object.entries(PROVIDER_FACTORIES)) {
    if (id === preferred) continue;
    const key = getApiKey(id, false);
    if (key) providers.push(factory(key));
  }

  return providers;
}

function getApiKey(provider: string, isPreferred: boolean): string | null {
  // Ollama: no API key required when it is the explicitly preferred provider.
  // As a background fallback it requires OLLAMA_API_KEY so that environments
  // without a running Ollama instance don't get surprise failures.
  if (provider === "ollama") {
    const envKey = process.env.OLLAMA_API_KEY ?? null;
    if (isPreferred) return envKey ?? "ollama";
    return envKey; // only include as fallback when explicitly configured
  }

  // Try encrypted vault first, then env vars
  const fromVault = retrieveCredential(`${provider}_api_key`);
  if (fromVault) return fromVault;

  const envMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };
  return process.env[envMap[provider] ?? ""] ?? null;
}
