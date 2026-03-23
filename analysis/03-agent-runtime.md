# 03 — Agent Runtime

## Executive Summary

The agent runtime is the central nervous system of the platform, responsible for orchestrating AI agent lifecycles from session initialization through streaming response delivery. The system handles multi-provider LLM integration (Anthropic, OpenAI, Google, Moonshot), retry logic with auth rotation, 82 tool implementations, 27 bundled skills, and a vector-backed memory subsystem. While feature-rich and functionally comprehensive, the runtime suffers from severe monolithic file structures — most critically a 3,212 LOC "God Object" in the attempt logic — and an uncontrollable external dependency on the core agent loop package. These structural weaknesses pose the greatest risk to long-term maintainability and any potential rebuild effort.

---

## Scope

This analysis covers the agent execution pipeline and its supporting subsystems:

| Layer | Key Paths | LOC (approx) |
|---|---|---|
| Agent Execution | `src/agents/pi-embedded-runner/run.ts` | 1,719 |
| Attempt Logic | `src/agents/pi-embedded-runner/run/attempt.ts` | 3,212 |
| Auto-Reply | `src/auto-reply/` | Multiple files |
| Tools | `src/agents/tools/` | 82 implementations |
| Skills | `skills/` | 27 bundled |
| Provider Abstraction | Spread across runner files | — |
| Context Engine | `src/context-engine/` | 6 files |
| Memory | `src/memory/`, `qmd-manager.ts` | 2,069+ |

Cross-references: [-> 01-gateway-core](01-gateway-core.md#sessions), [-> 02-channels-plugins](02-channels-plugins.md), [-> 06-security-model](06-security-model.md#exec-approval).

---

## Architecture

```
Inbound Message
       |
       v
  Auto-Reply Engine
  (directive parsing, subagent commands)
       |
       v
  runEmbeddedPiAgent()          <-- run.ts (1,719 LOC)
       |
       +-- Auth Profile Selection + Rotation
       +-- Multi-Attempt Retry (exponential backoff)
       |
       v
  Attempt Execution             <-- attempt.ts (3,212 LOC)
       |
       +-- Session Lock Acquisition
       +-- History Limiting / Compaction
       +-- Prompt Construction
       +-- Tool Instantiation (82 tools)
       +-- Skill Loading (bundled -> managed -> workspace)
       +-- Context Engine Delegation
       |
       v
  Provider Stream Wrapper
  (Anthropic | OpenAI | Google | Moonshot)
       |
       v
  Stream Processing + Tool Calls
       |
       v
  Memory Persistence (QMD + sqlite-vec)
```

### Key Architectural Decisions

1. **Single-file attempt orchestration**: All attempt logic — session prep, locking, history management, compaction, tool setup, prompt building, and stream processing — lives in one 3,212 LOC file.
2. **Flat tool directory**: 82 tool implementations sit in `src/agents/tools/` with no subdirectory organization by category.
3. **External core dependency**: The agent loop itself is governed by `@mariozechner/pi-agent-core`, `pi-ai`, and `pi-coding-agent` (v0.60.0), meaning the team cannot modify the fundamental agentic loop without forking.
4. **Provider-specific wrappers**: Each LLM provider has bespoke stream handling rather than a unified adapter interface.

---

## Detailed Findings

### 1. Agent Execution Flow — Rating: 3/5 (Adequate)

**File**: `src/agents/pi-embedded-runner/run.ts` (1,719 LOC)

`runEmbeddedPiAgent()` orchestrates the full agent lifecycle:
- Auth profile selection with rotation on failure
- Multi-attempt retry with exponential backoff
- Provider-specific stream wrapper instantiation
- Session state management across attempts

**Strengths**: The retry/rotation pattern is production-hardened; backoff prevents rate-limit cascades.
**Weaknesses**: Monolithic — 1,719 LOC in a single function file makes unit testing difficult. Orchestration, auth, and retry concerns are interleaved rather than composed.

---

### 2. Attempt Logic — Rating: 1/5 (Critical)

**File**: `src/agents/pi-embedded-runner/run/attempt.ts` (3,212 LOC)

This is the **largest file in the codebase** and the single greatest structural liability. It handles:
- Session preparation and lock acquisition
- Conversation history limiting and compaction on context overflow
- Tool instantiation for all 82 tools
- Prompt construction with skill/context injection
- Stream processing and response handling

**Risk**: Any change to attempt logic (tool registration, prompt format, compaction strategy) requires modifying this file. A bug in compaction can cascade into tool failures. Testing individual behaviors in isolation is effectively impossible without mocking the entire 3,212 LOC surface.

**Recommendation**: Decompose into at minimum 5 modules: `session-lock.ts`, `history-manager.ts`, `tool-registry.ts`, `prompt-builder.ts`, `stream-processor.ts`.

---

### 3. Auto-Reply System — Rating: 3/5 (Adequate)

**Directory**: `src/auto-reply/`

Handles directive parsing and subagent lifecycle management:

| Directive | Purpose |
|---|---|
| `/think` | Engage reasoning mode |
| `/verbose` | Increase output detail |
| `/exec` | Execute code blocks |
| `/queue` | Queue messages for processing |
| `/reply-to` | Target specific message/thread |

Subagent commands: `spawn`, `kill`, `focus`, `send`, `list`, `info`.

Thinking mode resolution supports inline, extended, and low/high variants.

**Strengths**: Clean directive syntax; subagent lifecycle is well-defined.
**Weaknesses**: Complexity accumulates as more directives are added; no formal grammar or parser — appears to rely on string matching.

---

### 4. Tool Ecosystem — Rating: 4/5 (Strong)

**Directory**: `src/agents/tools/` (82 implementations)

Comprehensive coverage across categories:

| Category | Examples |
|---|---|
| Session/Channel | Session management, channel ops |
| Code Execution | Sandboxed exec, REPL |
| Media/Web | Image gen, web fetch, search |
| Memory/Knowledge | QMD notes, vector search |
| System | File I/O, process management |

**Strengths**: 82 tools provide broad agent capability; each tool is self-contained.
**Weaknesses**: See Tool Organization below.

---

### 5. Tool Organization — Rating: 2/5 (Weak)

All 82 tool files in a flat directory with no categorical grouping. Discovering related tools requires reading filenames or grepping. No shared base class or interface validation is apparent — tool conformance is convention-based.

**Recommendation**: Organize into subdirectories (`tools/code/`, `tools/media/`, `tools/memory/`, etc.) with a shared `ToolBase` interface and registration mechanism.

---

### 6. Skills System — Rating: 4/5 (Strong)

**Directory**: `skills/` (27 bundled)

Each skill uses SKILL.md frontmatter with prompt hints. Three-tier loading:

1. **Bundled** — ships with the platform
2. **Managed** — installed/updated independently
3. **Workspace** — project-specific overrides

Environment variable injection per skill allows runtime configuration.

**Strengths**: Simple, effective design. The three-tier hierarchy provides good override semantics. Frontmatter format is easy to author.
**Weaknesses**: No versioning or dependency tracking between skills.

---

### 7. Provider Abstraction — Rating: 3/5 (Adequate)

Provider-specific stream wrappers handle:
- **Anthropic**: Cache TTL management for prompt caching
- **Google**: Function call sanitization (Gemini format differences)
- **OpenAI**: Standard streaming
- **Moonshot**: Custom handling

Auth supports OAuth + API key hybrid with profile rotation and cooldown tracking on rate limits.

**Weaknesses**: Each provider wrapper is bespoke rather than implementing a shared interface. Adding a new provider requires understanding each existing wrapper's quirks. Cache TTL logic is Anthropic-specific and hardcoded.

---

### 8. External AI Dependency — Rating: 2/5 (Weak)

The core agent loop depends on external packages:
- `@mariozechner/pi-agent-core`
- `pi-ai`
- `pi-coding-agent` (v0.60.0)

The team cannot modify the fundamental agentic reasoning loop, tool-call dispatch, or message formatting without forking these packages. Version pinning at v0.60.0 suggests deliberate lock to a known-good state.

**Risk**: Any upstream breaking change or abandonment leaves the platform stranded. Performance optimizations to the core loop are out of reach.

---

### 9. Context Engine — Rating: 3/5 (Adequate)

**Directory**: `src/context-engine/` (6 files)

Components: delegate, registry, legacy adapter, init, types.

Functions as an intermediary between skills/memory and prompt construction. The delegate pattern allows context sources to be registered and queried.

**Weaknesses**: "Legacy" adapter suggests incomplete migration. Only 6 files but unclear boundaries with the prompt construction in attempt.ts.

---

### 10. Memory Subsystem — Rating: 2/5 (Weak)

**Files**: `src/memory/`, `qmd-manager.ts` (2,069 LOC), manager sync ops (1,394 LOC)

- **QMD format**: Custom note format for persistent memory
- **Vector search**: sqlite-vec for semantic retrieval
- **Sync operations**: Bidirectional sync at 1,394 LOC

**Weaknesses**: `qmd-manager.ts` at 2,069 LOC is another monolith. QMD is a custom format with no external tooling support. The combination of format management, vector indexing, and sync in tightly coupled files makes the memory layer fragile.

---

## Dependencies

### Internal Dependencies
| Component | Depends On |
|---|---|
| Agent Execution | Auth profiles, Provider wrappers, Attempt logic |
| Attempt Logic | Tools, Skills, Context Engine, Memory, Session locks |
| Auto-Reply | Agent Execution (triggers runs), Subagent registry |
| Tools | Various platform services (sessions, channels, media APIs) |
| Skills | Filesystem (three-tier loading), Environment variables |
| Memory | sqlite-vec, QMD format parser, Sync engine |

### External Dependencies
| Package | Role | Risk |
|---|---|---|
| `@mariozechner/pi-agent-core` | Core agent loop | HIGH — uncontrollable |
| `pi-ai` | AI primitives | HIGH — tightly coupled |
| `pi-coding-agent` v0.60.0 | Coding capabilities | HIGH — version-pinned |
| `sqlite-vec` | Vector search for memory | MEDIUM — niche extension |
| LLM provider SDKs | Anthropic, OpenAI, Google, Moonshot | LOW — replaceable |

---

## Quality Metrics

| Metric | Value | Assessment |
|---|---|---|
| Largest file (attempt.ts) | 3,212 LOC | CRITICAL — God Object |
| Second largest (qmd-manager.ts) | 2,069 LOC | POOR |
| Third largest (run.ts) | 1,719 LOC | POOR |
| Tool count | 82 | Good coverage |
| Skill count | 27 bundled | Good coverage |
| Provider count | 4 | Adequate |
| Files over 1,000 LOC | 4+ | Systemic monolith pattern |
| External core dependency | Uncontrolled | HIGH RISK |
| Test coverage (estimated) | Low | Monolithic files resist unit testing |

---

## Rebuild Implications

### Must Preserve
1. **Multi-provider streaming** — Production-proven provider wrappers with auth rotation and backoff are battle-tested. Reimplement behind a unified interface but preserve the behavioral logic.
2. **82-tool ecosystem** — Each tool is self-contained and functional. Reorganize but do not rewrite from scratch.
3. **Skills three-tier loading** — Simple, effective pattern. Keep the bundled -> managed -> workspace hierarchy.
4. **Retry/rotation semantics** — Auth profile rotation with cooldown tracking prevents cascading failures.

### Must Refactor
1. **attempt.ts decomposition** — The 3,212 LOC God Object must be broken into at least 5 focused modules. This is the single highest-priority refactoring target in the entire codebase.
2. **qmd-manager.ts decomposition** — Split into format parser, vector index manager, and sync engine.
3. **Tool organization** — Move from flat directory to categorized subdirectories with a shared interface.
4. **Provider interface unification** — Define a `StreamProvider` interface that all providers implement, replacing bespoke wrappers.

### Must Decide
1. **Core agent loop ownership** — Fork `@mariozechner/pi-agent-core` and internalize, or accept the dependency risk. This is a strategic decision that affects every layer above.
2. **QMD format** — Keep the custom format or migrate to a standard (e.g., Markdown with YAML frontmatter + standard vector DB).
3. **Context engine migration** — The "legacy" adapter suggests an incomplete transition. Complete it or revert.

### Estimated Effort
| Work Item | Effort | Priority |
|---|---|---|
| Decompose attempt.ts | 2-3 weeks | P0 |
| Unify provider interface | 1-2 weeks | P1 |
| Reorganize tools directory | 1 week | P1 |
| Decompose qmd-manager.ts | 1-2 weeks | P1 |
| Fork/internalize core agent loop | 3-4 weeks | P0 (strategic) |
| Complete context engine migration | 1 week | P2 |
| Add unit tests for decomposed modules | 2-3 weeks | P1 |

### Risk Assessment
The agent runtime's greatest risk is the **combination** of monolithic internal architecture and uncontrolled external dependency. If `pi-agent-core` requires changes (new model support, tool-call format changes, performance fixes), the team must either wait for upstream or fork — and forking into a codebase already struggling with 3,000+ LOC files compounds the maintenance burden. Addressing the internal monolith problem first creates the structural clarity needed to evaluate and potentially absorb the external dependency.
