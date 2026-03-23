# 12 -- Decision Matrix: OpenClaw vs Nexus

> **Status**: Complete
> **Date**: 2026-03-22
> **Depends On**: All analysis docs (01 through 10)
> **Depended On By**: [-> 13-rebuild-blueprint](13-rebuild-blueprint.md)

---

## Purpose

This document provides a weighted, evidence-based scoring comparison between **OpenClaw** (the existing codebase) and **Nexus** (the proposed clean-room rebuild). Each dimension is scored 1--5 using the scale defined in [-> CONVENTIONS](CONVENTIONS.md), with weights reflecting rebuild priorities. Evidence references link to source analysis documents.

---

## Scoring Methodology

- **OpenClaw scores** are derived from the ratings assigned in the individual analysis docs (01--10), aggregated per dimension.
- **Nexus scores** represent the achievable target if the rebuild blueprint in [-> 13-rebuild-blueprint](13-rebuild-blueprint.md) is executed. These are design-intent scores, not implementation-proven scores.
- **Weighted total** = sum of (score x weight) for each dimension.

---

## Decision Matrix

| # | Dimension | Weight | OpenClaw | Nexus | Evidence & Rationale |
|---|-----------|--------|----------|-------|----------------------|
| 1 | **Architecture Simplicity** | 20% | 2 | 5 | See below |
| 2 | **AI Capabilities** | 20% | 4 | 4 | See below |
| 3 | **UX / Onboarding** | 15% | 2 | 5 | See below |
| 4 | **Security** | 15% | 3 | 5 | See below |
| 5 | **Platform Coverage** | 10% | 4 | 3 | See below |
| 6 | **Code Quality** | 10% | 3 | 5 | See below |
| 7 | **Extensibility** | 10% | 3 | 5 | See below |
| | **Weighted Total** | 100% | **2.90** | **4.65** | |

---

## Dimension Details

### 1. Architecture Simplicity (Weight: 20%)

| | OpenClaw: 2 | Nexus: 5 |
|---|---|---|
| **Gateway** | God Object at 1,354 LOC with 10-step rigid startup, 100+ server methods in a single namespace, no dependency injection. [-> 01-gateway-core: Server Implementation](01-gateway-core.md) rated 2/5. | 12-module architecture with dependency injection, phase-based startup, max 500 LOC per file. |
| **Agent Runtime** | `attempt.ts` at 3,212 LOC is the largest file in the codebase -- a single function with 95+ imports. [-> 03-agent-runtime: Attempt Logic](03-agent-runtime.md) rated 1/5. `run.ts` at 1,719 LOC. `qmd-manager.ts` at 2,069 LOC. | Decomposed into 5+ focused modules (session-lock, history, tool-registry, prompt-builder, stream-processor). Pipeline architecture replaces monolithic function. |
| **File Count** | 4,419 TypeScript source files, 75+ monorepo packages. [-> 07-code-quality](07-code-quality.md): 130 files exceed the 700-LOC guideline. | Target <2,000 files, 12 core modules, single-package workspace. |
| **Dependencies** | 46 production dependencies, 3 schema libraries (Ajv, TypeBox, Zod), 2 web frameworks (Express, Hono phantom), external Pi runtime in 244 files. [-> 07-code-quality: Dependency Hygiene](07-code-quality.md) rated 2/5. | Single schema library (Zod), single web framework (Hono), own agent loop, <20 production dependencies. |
| **Session Storage** | File-based JSONL with no locking, no concurrent-write safety, linear scan reads. [-> 01-gateway-core: Sessions](01-gateway-core.md) rated 2/5. | SQLite with WAL mode -- single file, ACID, indexed queries, built-in compaction. |

---

### 2. AI Capabilities (Weight: 20%)

| | OpenClaw: 4 | Nexus: 4 |
|---|---|---|
| **Provider Coverage** | 4 core providers (Anthropic, OpenAI, Google, Moonshot) + 32 provider extensions. Auth rotation with cooldown tracking. [-> 03-agent-runtime: Provider Abstraction](03-agent-runtime.md) rated 3/5. | Unified `StreamProvider` interface. Start with top 5 providers; extensible via plugin SDK. Preserve auth rotation + backoff semantics. |
| **Tool Ecosystem** | 82 tool implementations covering communication, web, media, browser, infra. [-> 03-agent-runtime: Tool Ecosystem](03-agent-runtime.md) rated 4/5. | Reorganize existing 82 tools into categorized subdirectories with shared `ToolBase` interface. No tool loss. |
| **Skills** | 52 bundled skills with 3-tier loading (bundled, managed, workspace). [-> 03-agent-runtime: Skills System](03-agent-runtime.md) rated 4/5. | Preserve the 3-tier hierarchy and SKILL.md frontmatter format. Add versioning. |
| **Memory** | QMD format + sqlite-vec for semantic retrieval. Custom format, monolithic manager (2,069 LOC). [-> 03-agent-runtime: Memory Subsystem](03-agent-runtime.md) rated 2/5. | SQLite-backed memory with standard Markdown + YAML frontmatter. Vector search via sqlite-vec (retained). Decomposed manager. |
| **Agent Loop** | External dependency on `@mariozechner/pi-*` (v0.60.0) across 244 files. [-> 03-agent-runtime: External AI Dependency](03-agent-runtime.md) rated 2/5, [-> 07-code-quality: Pi Runtime](07-code-quality.md) rated 2/5. | Own agent loop. Full control over reasoning, tool dispatch, message formatting. Eliminates single-author external risk. |
| **Net Assessment** | Feature-rich and battle-tested, but structural weaknesses (monolithic attempt logic, uncontrolled external dependency, custom memory format) offset the breadth. Scores 4 because the capabilities work in production. | Equivalent feature set by design (port all tools and skills). Scores 4 because production-proving takes time -- the architectural improvements do not add new AI capabilities, they make existing ones more maintainable. |

---

### 3. UX / Onboarding (Weight: 15%)

| | OpenClaw: 2 | Nexus: 5 |
|---|---|---|
| **First-Run Time** | QuickStart path: 3--4 minutes without channels, 5--7 with one channel. Manual: 10--15 minutes. Security wall adds 30--60 seconds before any config. [-> 10-ux-analysis: Onboarding Flow](10-ux-analysis.md) rated 3/5 but time target missed. | Target: <90 seconds for instant setup (`nexus init` -- API key only, auto-detect provider, start, open dashboard). Full setup as separate `nexus configure` command. |
| **Decision Overload** | 54 auth choices, 15+ channel options, search/skills/hooks prompts all during first run. 1,494 config keys. 45 CLI commands (17 core + 28 sub-CLIs). [-> 10-ux-analysis: Configuration Complexity](10-ux-analysis.md) rated 2/5, [-> 10-ux-analysis: CLI Ergonomics](10-ux-analysis.md) rated 2/5. | Top 5 providers at first run. Channels as post-setup step. ~200 primary config keys with tiering (essential/recommended/advanced). ~15 primary CLI commands with `nexus advanced <cmd>` for the rest. |
| **Doctor** | 27 diagnostic modules across 5,507 LOC. No quick mode -- runs everything sequentially. No summary table. [-> 10-ux-analysis: Doctor Diagnostics](10-ux-analysis.md) rated 4/5. | Quick mode (6 checks) + full mode (all checks). Summary table at end. |
| **Documentation** | 362 English pages with 14 files in `docs/start/` alone -- too many entry points. [-> 10-ux-analysis: Documentation](10-ux-analysis.md) rated 3/5. | 3 start pages: Getting Started, Advanced Setup, CLI Reference. Progressive disclosure. |
| **Web UI** | 150+ `@state()` properties, 85KB render file, no component library. [-> 04-web-ui: App Architecture](04-web-ui.md) rated 2/5. | SolidJS with ~15 store slices, Kobalte headless components, Tailwind CSS v4, route-based lazy loading. |

---

### 4. Security (Weight: 15%)

| | OpenClaw: 3 | Nexus: 5 |
|---|---|---|
| **Auth System** | 5 auth modes, timing-safe comparison, rate limiting. Strong. But rate limiter is in-memory only (lost on restart), password has no rotation mechanism, device auth uses fragile pipe-delimited format. [-> 06-security-model: Auth System](06-security-model.md) rated 4/5. | SQLite-backed persistent rate limiting. Structured JSON auth payloads. Keychain-integrated credential rotation. |
| **Credential Storage** | Unencrypted at rest. Config file world-readable by default. Secrets cannot be rotated without restart. [-> 06-security-model: Credential Storage](06-security-model.md) rated 2/5. | AES-256-GCM encrypted credentials with OS keychain integration for key material. Runtime rotation without restart. |
| **Prompt Injection** | Detection with 12+ patterns, but advisory only -- logs but does not enforce/block. [-> 06-security-model: Prompt Injection Defense](06-security-model.md) rated 2/5. | Enforced prompt guard with configurable severity levels (block, warn, allow). Escape hatch for trusted content. |
| **Allowlists** | Per-channel enforcement, not centralized. [-> 06-security-model: DM Pairing](06-security-model.md) rated 3/5. | Centralized gateway-level allowlist with per-channel overrides. Single enforcement point. |
| **Audit Trail** | No persistent audit trail for exec approvals -- fire-and-forget. [-> 06-security-model: Exec Approval](06-security-model.md) rated 3/5. | SQLite audit table for all exec approvals, config changes, auth events, credential access. |
| **Sandbox** | Multi-pass path traversal protection, Docker/SSH backends. Strong. [-> 06-security-model: Sandbox](06-security-model.md) rated 4/5. | Preserve existing sandbox patterns. No regression. |

---

### 5. Platform Coverage (Weight: 10%)

| | OpenClaw: 4 | Nexus: 3 |
|---|---|---|
| **Native Apps** | macOS (Swift menu bar), iOS (Swift), Android (Kotlin). Shared OpenClawKit across Apple platforms. 605 Swift files, 115 Kotlin files. [-> 05-native-apps](05-native-apps.md). | Phase 6 deliverable -- native apps come last. Initial focus on web + CLI. API-first design enables future native apps. |
| **Messaging Channels** | 23 messaging channel extensions covering Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Teams, Matrix, IRC, LINE, and more. [-> 09-feature-inventory: Messaging Channels](09-feature-inventory.md). | Start with 5 core channels (Telegram, Discord, Slack, WhatsApp, web). Remaining channels ported via plugin SDK. |
| **Desktop/Mobile** | macOS LaunchAgent, iOS push notifications, Android Compose, QR onboarding. [-> 05-native-apps: macOS App](05-native-apps.md) rated 4/5. | Web-first. Desktop via PWA initially. Native apps in later phases. |
| **CI Platforms** | Linux, macOS, Windows CI with 16-vCPU Blacksmith runners, 6-shard Windows matrix, Parallels VM smoke tests. [-> 08-testing-infrastructure: CI/CD Pipeline](08-testing-infrastructure.md) rated 5/5. | Linux + macOS CI initially. Windows added when native app work begins. |
| **Net Assessment** | OpenClaw has deep platform coverage built over years. This is the one dimension where the rebuild starts behind and must catch up incrementally. | Lower initial score is intentional -- platform breadth is deferred to prioritize architecture, security, and UX foundations. The plugin architecture ensures channels can be ported without core changes. |

---

### 6. Code Quality (Weight: 10%)

| | OpenClaw: 3 | Nexus: 5 |
|---|---|---|
| **TypeScript Discipline** | `strict: true`, Oxlint with `no-explicit-any: error`. Good intentions. But `as any` appears 107 times in tests, `no-unsafe-type-assertion` is off. [-> 07-code-quality: TypeScript Strictness](07-code-quality.md) rated 4/5. | `strict: true`, `no-unsafe-type-assertion: error`, zero `as any` policy (including tests). Zod for runtime validation at all boundaries. |
| **File Sizes** | 130 files exceed 700-LOC guideline. Top offender: 3,212 LOC. [-> 07-code-quality: File Size Violations](07-code-quality.md) rated 2/5. | Hard 500-LOC CI gate. No exceptions. |
| **Module Boundaries** | 101 files in `src/` import from `extensions/` -- boundary is aspirational. 80+ SDK subpath exports. 15+ custom lint scripts to police leaks. [-> 07-code-quality: Module Boundaries](07-code-quality.md) rated 2/5. | Workspace-level package boundaries with explicit `exports` fields. No regex-based lint enforcement needed -- the boundary is structural. |
| **Schema Consistency** | 3 overlapping schema libraries (Ajv, TypeBox, Zod) across 95 files. [-> 07-code-quality: Dependency Hygiene](07-code-quality.md) rated 2/5. | Zod only. One library, one pattern, every boundary. |
| **Test Infrastructure** | 2,806 test files, 449K test LOC, custom parallel runner, behavioral manifests, 9 Vitest configs. Exceptionally mature. [-> 08-testing-infrastructure](08-testing-infrastructure.md) rated 4.5/5. | Adopt colocated test pattern, test isolation approach, behavioral manifests. Simplify to 3 Vitest configs (unit, integration, e2e). |
| **Error Handling** | Structured error codes, generally disciplined. Some `.catch(() => false)` silent swallows. 40 `console.log` usages instead of structured logger. [-> 07-code-quality: Error Handling](07-code-quality.md) rated 3/5. | `Result<T, E>` pattern for all fallible operations. Zero `console.log` policy -- structured logger only. |

---

### 7. Extensibility (Weight: 10%)

| | OpenClaw: 3 | Nexus: 5 |
|---|---|---|
| **Plugin Interface** | `ChannelPlugin<R, P, A>` with 25+ optional adapters is a 5/5 design. [-> 02-channels-plugins: Channel Adapter Pattern](02-channels-plugins.md) rated 5/5. | Preserve the optional-adapter pattern with generic type parameters. This is the architectural crown jewel. |
| **Plugin SDK Surface** | 30+ (some reports say 80+) export paths create a wide coupling surface. Discoverability is poor. [-> 02-channels-plugins: Plugin SDK Surface](02-channels-plugins.md) rated 2/5, [-> 07-code-quality: Module Boundaries](07-code-quality.md). | 3 top-level exports: `nexus/plugin-sdk/channel`, `nexus/plugin-sdk/runtime`, `nexus/plugin-sdk/testing`. Maximum. |
| **Plugin Loader** | Jiti-based dynamic import with LRU(128). No timeout, no circuit breaker. [-> 02-channels-plugins: Plugin Loader](02-channels-plugins.md) rated 3/5. | Pre-compiled extension cache for production. Load timeouts + circuit breaker. Configurable cache size. |
| **Contract Testing** | Reusable contract tests across channel types. Missing PluginRuntime failure-mode coverage. [-> 02-channels-plugins: Contract Testing](02-channels-plugins.md) rated 4/5. | Expanded contract tests with PluginRuntime injection failure coverage. Required capability declaration in plugin manifest. |
| **Extension Ecosystem** | 77 extensions across channels, providers, speech, memory, and utilities. [-> 09-feature-inventory: Extensions](09-feature-inventory.md). | Plugin SDK backward compatibility layer for gradual migration. New extensions use simplified 3-export SDK. |

---

## Weighted Score Calculation

| Dimension | Weight | OpenClaw | Weighted OC | Nexus | Weighted NX |
|-----------|--------|----------|-------------|-------|-------------|
| Architecture Simplicity | 0.20 | 2 | 0.40 | 5 | 1.00 |
| AI Capabilities | 0.20 | 4 | 0.80 | 4 | 0.80 |
| UX / Onboarding | 0.15 | 2 | 0.30 | 5 | 0.75 |
| Security | 0.15 | 3 | 0.45 | 5 | 0.75 |
| Platform Coverage | 0.10 | 4 | 0.40 | 3 | 0.30 |
| Code Quality | 0.10 | 3 | 0.30 | 5 | 0.50 |
| Extensibility | 0.10 | 3 | 0.30 | 5 | 0.50 |
| **Total** | **1.00** | | **2.95** | | **4.60** |

---

## Verdict

**Nexus scores 56% higher than OpenClaw** (4.60 vs 2.95) on weighted dimensions. The gap is largest in architecture simplicity (+3), UX/onboarding (+3), security (+2), and code quality (+2). OpenClaw leads only in platform coverage (+1), reflecting years of native app investment that a rebuild must deprioritize initially.

**The rebuild is justified.** The architectural debt documented in [-> 01-gateway-core](01-gateway-core.md), [-> 03-agent-runtime](03-agent-runtime.md), and [-> 07-code-quality](07-code-quality.md) is not incrementally fixable -- the God Objects, external runtime dependency, triple schema libraries, and leaky module boundaries are load-bearing structural problems. A clean-room rebuild preserving the proven patterns (channel adapter interface, skills hierarchy, contract testing, test isolation) while eliminating the structural debt is the recommended path.

**Key risk:** Nexus scores are design-intent. Execution risk could erode the advantage, particularly in AI capabilities (owning the agent loop) and platform coverage (native app timeline). The phased implementation plan in [-> 13-rebuild-blueprint](13-rebuild-blueprint.md) mitigates this by delivering value incrementally.

---

**Next:** [-> 13-rebuild-blueprint](13-rebuild-blueprint.md) -- Clean-room architecture specification
**Depends on:** All analysis docs (01--10), [-> CONVENTIONS](CONVENTIONS.md)
