/**
 * Provider resolver — selects and authenticates a provider with failover.
 *
 * Replaces OpenClaw's auth profile rotation scattered across run.ts/attempt.ts.
 * Key improvement: single file, <150 LOC, clear failover chain.
 */
import { createLogger, retrieveCredential, getAllConfig, recordAudit } from "@nexus/core";
import type { Provider } from "./base.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";

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

export function resolveProvider(providerOverride?: string, modelOverride?: string): ResolvedProvider {
  const config = getAllConfig();
  const targetProvider = providerOverride ?? config.agent.defaultProvider;
  const targetModel = modelOverride ?? config.agent.defaultModel;

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

function buildProviderChain(preferred: string): Provider[] {
  const providers: Provider[] = [];

  const anthropicKey = getApiKey("anthropic");
  const openaiKey = getApiKey("openai");

  if (preferred === "anthropic" && anthropicKey) {
    providers.push(createAnthropicProvider(anthropicKey));
  }
  if (preferred === "openai" && openaiKey) {
    providers.push(createOpenAIProvider(openaiKey));
  }
  // Add remaining as fallbacks
  if (preferred !== "anthropic" && anthropicKey) {
    providers.push(createAnthropicProvider(anthropicKey));
  }
  if (preferred !== "openai" && openaiKey) {
    providers.push(createOpenAIProvider(openaiKey));
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
  };
  return process.env[envMap[provider] ?? ""] ?? null;
}
