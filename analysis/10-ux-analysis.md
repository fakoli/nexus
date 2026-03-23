# 10 - UX Analysis: OpenClaw CLI & Onboarding

**Analysis date:** 2026-03-22
**Scope:** Onboarding flow, doctor diagnostics, configuration complexity, CLI ergonomics, error messages, documentation, first-run experience, config vs convention tradeoffs.
**Goal:** Evaluate "How hard is it for a new user to get this working?" and identify what a rebuild must fix to achieve <5 minute onboarding.

---

## Executive Summary

OpenClaw has a surprisingly well-documented and thoughtful onboarding system, but it drowns new users in decisions, warnings, and complexity that is proportional to its power-user feature set. The core tension: OpenClaw is a multi-channel, multi-provider, multi-agent personal AI gateway -- and the UX reflects every one of those dimensions at setup time.

**Key findings:**

- The onboarding wizard asks 8-12 interactive questions on the "QuickStart" path and 15-20+ on "Manual"
- The `doctor` command runs 27 discrete diagnostic modules across ~5,500 LOC -- more than many entire CLI tools
- There are **~1,494 documented config keys** in the schema help file (1,637 LOC)
- The CLI exposes **45 top-level commands** (17 core + 28 sub-CLIs), many with their own subcommand trees
- Documentation spans **362 English pages** (679 including translations)
- The security warning wall during onboarding is 25+ lines of text before the user can proceed

**Verdict for rebuild:** The existing UX is competent for power users but violates the <5 minute target for anyone who just wants "AI chatbot on my phone." A rebuild should separate the "quick API key + go" path from the "full gateway operator" path, and push 90% of configuration to post-setup progressive disclosure.

---

## Detailed Findings

### 1. Onboarding Flow (Rating: 3/5)

**Files analyzed:**
- `src/commands/onboard.ts` (entry point, 102 LOC)
- `src/commands/onboard-interactive.ts` (31 LOC, delegates to wizard)
- `src/wizard/setup.ts` (main wizard, 593 LOC)
- `src/commands/onboard-types.ts` (171 LOC, 54 auth choices)
- `src/commands/onboard-channels.ts` (915 LOC)
- `src/commands/onboard-search.ts` (409 LOC)
- `src/commands/onboard-skills.ts` (222 LOC)
- `src/commands/onboard-custom.ts` (921 LOC)
- `src/commands/onboard-hooks.ts` (85 LOC)
- Plus 4 more onboard-* modules

**Total onboarding code:** ~3,167 LOC across 14 non-test files, plus the 593-line wizard orchestrator.

**Onboarding steps (interactive QuickStart path):**

1. Security warning wall (25+ lines) -- user must confirm risk acknowledgement
2. QuickStart vs Manual mode selection
3. If existing config: Keep / Update / Reset decision
4. Auth provider selection (54 built-in auth choices grouped into 28 provider groups)
5. API key entry for chosen provider
6. Default model selection
7. Gateway config summary (port, bind, auth displayed; auto-configured in QuickStart)
8. Channel setup: multi-select from all available channels, per-channel credential prompts
9. Search provider setup (Brave, Perplexity, Tavily, etc.)
10. Skills configuration (eligible/missing/blocked inventory)
11. Hooks configuration (session memory)
12. Final write + daemon install offer + dashboard open

**Strengths:**
- QuickStart mode genuinely reduces decisions (skips gateway tuning, uses defaults)
- Non-interactive mode exists with full flag coverage for automation
- Existing config detection with keep/update/reset is thoughtful
- Gateway probe at start tells user if something is already running

**Weaknesses:**
- The security warning wall is intimidating and should not block first-run for a personal loopback setup
- 54 auth choices (in `BuiltInAuthChoice`) is overwhelming even when grouped
- Channel setup during onboarding is premature -- most users want one channel, not a menu of 15+
- The wizard cannot be resumed; if it fails mid-way, the user starts over
- Skills and search setup during initial onboarding adds 2-3 more prompts to an already long flow

**Time estimate:** QuickStart path with one provider, no channels: ~3-4 minutes. With one channel (e.g., Telegram): ~5-7 minutes. Manual path with channels + skills: 10-15 minutes.

### 2. Doctor Diagnostics (Rating: 4/5)

**Files analyzed:**
- `src/commands/doctor.ts` (orchestrator, 385 LOC)
- 27 doctor sub-modules totaling ~5,507 LOC
- `src/commands/doctor-prompter.ts` (113 LOC)

**Diagnostic modules (by LOC, descending):**

| Module | LOC | What it checks |
|--------|-----|----------------|
| doctor-state-integrity | 847 | Cloud storage sync conflicts, file corruption, backup tips |
| doctor-legacy-config | 847 | Config schema migrations from older versions |
| doctor-gateway-services | 452 | LaunchAgent/systemd service config, multi-service conflicts |
| doctor-auth | 370 | OAuth profile health, deprecated CLI auth profiles |
| doctor-sandbox | 312 | Docker sandbox image freshness, scope warnings |
| doctor-gateway-daemon-flow | 288 | Daemon start/stop/repair cycle |
| doctor-security | 239 | Security posture warnings |
| doctor-memory-search | 233 | Memory search index health, provider availability |
| doctor-platform-notes | 221 | macOS LaunchAgent overrides, startup optimization |
| doctor-cron | 183 | Cron store repair |
| doctor-completion | 179 | Shell completion setup |
| doctor-config-flow | 156 | Config load + migration orchestration |
| doctor-config-analysis | 156 | Config structure validation |
| doctor-ui | 154 | UI protocol version freshness |
| doctor-browser | 150 | Chrome/Chromium CDP readiness |
| doctor-config-preflight | 109 | Pre-check before full doctor run |
| doctor-bootstrap-size | 101 | Workspace bootstrap file size check |
| doctor-gateway-health | 92 | Live gateway health probe |
| doctor-workspace-status | 88 | Workspace directory state |
| doctor-update | 88 | Version update availability |
| doctor-session-locks | 85 | Stale session lock cleanup |
| doctor-format | 81 | Config formatting normalization |
| doctor-workspace | 60 | Memory system suggestion |
| doctor-install | 40 | Source install issue detection |
| doctor-gateway-auth-token | 30 | Gateway token generation |
| doctor-state-migrations | 12 | Legacy state migration detection |

**Is this complexity justified?** Mostly yes. The system supports macOS (LaunchAgent), Linux (systemd), Docker, WSL2, cloud-synced config directories, multiple auth providers with OAuth, legacy config migrations across years of evolution, and sandbox container management. Each diagnostic module addresses a real failure mode.

**Strengths:**
- `--fix` flag for auto-repair is excellent UX
- `--non-interactive` mode for CI/automation
- Modular architecture: each check is isolated and testable
- Prompter abstraction cleanly handles interactive/non-interactive/repair modes

**Weaknesses:**
- No "levels" of doctor (quick vs deep) -- it runs everything sequentially
- A fresh install still runs all 27 modules, most of which are irrelevant
- No summary at the end of what was checked/passed/warned -- just sequential output
- Legacy migration modules (847 LOC each) will grow forever without pruning

### 3. Configuration Complexity (Rating: 2/5)

**File analyzed:** `src/config/schema.help.ts` (1,637 LOC, 1,494 documented config keys)

**Config namespace breakdown (approximate key counts):**

| Namespace | Approx. keys | Purpose |
|-----------|-------------|---------|
| `gateway.*` | ~120 | Gateway server, auth, TLS, reload, proxy, push, HTTP |
| `channels.*` | ~250+ | Per-channel config (Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Teams, Mattermost, IRC...) |
| `agents.*` | ~200+ | Agent defaults, per-agent overrides, memory search, sandbox, heartbeat |
| `tools.*` | ~150+ | Exec, web, media, links, sandbox, approvals, loop detection |
| `models.*` | ~40 | Provider catalog, Bedrock discovery |
| `plugins.*` | ~50 | Plugin loading, slots, per-plugin entries |
| `browser.*` | ~50 | CDP, profiles, SSRF policy, snapshots |
| `memory.*` | ~40 | QMD backend, citations, sessions |
| `talk.*` | ~20 | Voice synthesis |
| `acp.*` | ~30 | Agent Control Protocol |
| `diagnostics.*` | ~30 | OTel, cache trace, flags |
| `auth.*` | ~15 | Multi-profile credentials, cooldowns |
| Other (meta, wizard, update, discovery, logging, cli, ui, etc.) | ~100+ | |

**The core problem:** A new user needs to set maybe 5-10 config values to get started (gateway mode, auth token, one channel credential, model provider). But the config schema exposes 1,494 knobs because the system supports every possible deployment topology (loopback, LAN, Tailscale, remote, TLS, proxy, multi-agent, sandbox, etc.).

**Config vs Convention analysis:**
- **Has sensible defaults:** Gateway port (18789), bind (loopback), auth (token, auto-generated), model catalog (built-in), tool profiles, logging level
- **Must be configured:** At least one model provider API key, gateway mode (local/remote)
- **Should be configured but has defaults:** Gateway auth token (auto-generated), workspace path, channel credentials

**Verdict:** The schema is well-documented (every key has a help string), but the sheer volume is a discoverability problem. There is no concept of "tiers" (essential, recommended, advanced, expert).

### 4. CLI Ergonomics (Rating: 2/5)

**Files analyzed:**
- `src/cli/program/core-command-descriptors.ts` (17 core commands)
- `src/cli/program/subcli-descriptors.ts` (28 sub-CLI commands)
- `src/cli/program/command-registry.ts` (lazy loading system)

**Total top-level commands: 45**

**Core commands (17):** setup, onboard, configure, config, backup, doctor, dashboard, reset, uninstall, message, memory, agent, agents, status, health, sessions, browser

**Sub-CLI commands (28):** acp, gateway, daemon, logs, system, models, approvals, nodes, devices, node, sandbox, tui, cron, dns, docs, hooks, webhooks, qr, clawbot, pairing, plugins, channels, directory, security, secrets, skills, update, completion

**Command tree depth:** Up to 3 levels deep (e.g., `openclaw channels add --channel telegram`)

**Ergonomic issues:**
1. **Confusing near-duplicates:** `setup` vs `onboard` vs `configure` -- three distinct commands for getting configured. `agent` (singular, run a turn) vs `agents` (plural, manage agents). `node` vs `nodes`. `daemon` (legacy alias for gateway service).
2. **45 commands is overwhelming** for `--help` output. No grouping or categories in the help display.
3. **No progressive disclosure:** A brand new user sees the same 45 commands as a power user.
4. **Lazy loading is a smart performance optimization** -- only the invoked command's module is loaded.

**Positive notes:**
- Each command has a clear, concise description
- Lazy loading means startup is fast despite the large surface
- Shell completion support exists (`openclaw completion`)
- `openclaw docs` searches live documentation -- good discoverability feature

### 5. Error Messages (Rating: 4/5)

**Spot-check of error messages across command files:**

**Good patterns found:**
- `Config invalid. Run \`openclaw doctor\` to repair it, then re-run setup.` -- actionable, tells user what to do next
- `Non-interactive setup requires explicit risk acknowledgement.` + `Re-run with: openclaw onboard --non-interactive --accept-risk ...` -- shows exact fix command
- `Invalid --mode "..." (use local|remote).` -- lists valid values
- `Channel is required. Use --channel <name>.` -- clear parameter guidance
- `Gateway auth is off or missing a token. Token auth is now the recommended default.` -- explains why and what to do
- `Windows detected - OpenClaw runs great on WSL2!` + guide link -- platform-aware, friendly

**Areas for improvement:**
- Some errors are bare string dumps: `runtime.error(String(err))` -- loses context
- Docker/sandbox errors could be more prescriptive about installation steps
- The security warning in onboarding is effective but dense -- could use progressive formatting

**Overall:** Error messages are above average for a CLI tool. Most include the fix command or a docs link. The pattern of `formatCliCommand("openclaw ...")` ensures consistent formatting.

### 6. Documentation (Rating: 3/5)

**Stats:**
- **362 English doc pages** (679 total including zh-CN and ja-JP translations)
- **25 top-level doc directories** including: start, install, channels, gateway, tools, security, plugins, platforms, concepts, automation, diagnostics, debug, help, reference, web, nodes, cli, providers

**Structure analysis:**
- `docs/start/` has 14 pages including getting-started, quickstart, onboarding, wizard reference
- `docs/channels/` covers every supported channel with individual pages
- `docs/tools/` has 25+ pages for individual tools
- `docs/platforms/` covers macOS, Linux, Windows, iOS, Android, Raspberry Pi, DigitalOcean, Oracle
- Translation pipeline exists (zh-CN, ja-JP) with glossary and translation memory

**Strengths:**
- Mintlify-hosted with good navigation structure
- Getting Started page promises "about 5 minutes" and has a clear 5-step flow
- Every channel has its own dedicated doc page
- i18n pipeline for Chinese and Japanese

**Weaknesses:**
- 362 pages is a lot -- finding what you need requires either good search or the right entry point
- Multiple "start" pages (getting-started, quickstart redirect, onboarding, onboarding-overview, setup, wizard, wizard-cli-reference, wizard-cli-automation) create confusion about which is canonical
- docs/start/ alone has 14 files -- too many entry points for a new user

### 7. First-Run Experience (Rating: 3/5)

**`openclaw onboard` flow:**

1. ASCII art banner (lobster logo, 6 lines)
2. "OpenClaw setup" intro via @clack/prompts
3. **Security warning wall** (25 lines of text about risks, shared inboxes, sandbox, etc.)
4. Risk confirmation prompt (defaults to "No" -- user must actively agree)
5. QuickStart vs Manual mode selection
6. Auth provider grouped selection (28 groups)
7. API key entry
8. Model selection
9. Gateway config (auto in QuickStart)
10. Channel setup offer
11. Search provider setup offer
12. Skills setup offer
13. Hooks setup
14. Config write + daemon install offer
15. Dashboard open

**What works:** The QuickStart path genuinely tries to minimize decisions. Auto-generated gateway tokens, sensible port defaults, and loopback-only binding mean a new user can skip networking concerns.

**What does not work for <5 minute target:**
- The security wall adds 30-60 seconds of reading before any config happens
- Auth choice requires understanding the provider landscape
- Channel setup should be a separate post-install step
- Skills and search setup add unnecessary friction to first run

**`openclaw gateway` (run command):**
Not directly analyzed as a standalone first-run path, but the Getting Started docs show `openclaw gateway status` as step 3, which correctly assumes the daemon was installed during onboard.

### 8. Config vs Convention (Rating: 3/5)

**What has sensible defaults (no config needed):**
- Gateway port: 18789
- Gateway bind: loopback (safe default)
- Gateway auth: token mode with auto-generated token
- Workspace: `~/.openclaw/agents/default`
- Logging: info level
- Tool profile: built-in defaults
- Update channel: stable
- Memory search: built-in provider
- Session management: automatic

**What must be configured (no working defaults):**
- Model provider credentials (at least one API key)
- Gateway mode (local vs remote) -- wizard sets this
- Channel credentials (per-channel tokens/keys)

**What should be configured but works without:**
- Channels (system works with just Control UI web chat)
- Skills (enhance but not required)
- Search providers (optional tool)
- Sandbox/Docker (security hardening, not required)
- TLS (only needed for non-loopback)

**Verdict:** The defaults are actually quite good for a loopback personal setup. The problem is that the onboarding wizard front-loads decisions about channels, search, and skills that could be deferred.

---

## Cross-References

| Finding | Related Analysis | Impact |
|---------|-----------------|--------|
| 54 auth choices | 02-channels-plugins.md (provider ecosystem) | Each new provider adds onboarding complexity |
| 27 doctor modules | 01-gateway-core.md (gateway architecture) | Doctor complexity mirrors gateway complexity |
| 1,494 config keys | 03-agent-runtime.md (agent config surface) | Agent + memory config alone is ~200+ keys |
| 45 CLI commands | 04-web-ui.md (Control UI) | Many CLI commands have no UI equivalent |
| Security warning wall | 06-security-model.md | Security model requires upfront education |
| Channel setup in onboard | 02-channels-plugins.md | Plugin architecture adds setup steps |

---

## Rebuild Implications

### Critical for <5 Minute Onboarding

1. **Split onboarding into two tiers:**
   - **Instant setup** (target: 90 seconds): `openclaw init` -- API key only, auto-detect provider, generate token, start gateway, open dashboard. Zero questions about channels, search, skills, or networking.
   - **Full setup** (current wizard): rename to `openclaw configure` or keep as `openclaw onboard --advanced`

2. **Defer the security wall:** For loopback-only personal setups, the security warning is unnecessary friction. Show it when the user first enables non-loopback binding, adds a channel, or enables tools.

3. **Reduce auth choices at first run:** Show top 5 providers (Anthropic, OpenAI, Google, OpenRouter, local/Ollama) with "More providers..." expansion. The current 28-group list is overwhelming.

4. **Make channels a post-setup step:** `openclaw channels add telegram` should be the channel setup path, not part of initial onboarding.

### Important for CLI Ergonomics

5. **Command grouping in help output:** Show commands in categories (Setup, Runtime, Channels, Advanced) instead of a flat alphabetical list.

6. **Resolve naming confusion:** Pick one of `setup`/`onboard`/`configure` as the canonical entry point. Deprecate the other two. Resolve `agent`/`agents` and `node`/`nodes` confusion.

7. **Config tiering:** Introduce `openclaw config explain <key>` and tag config keys as essential/recommended/advanced/expert in schema.help.ts so users can progressively discover configuration.

### Important for Doctor

8. **Quick doctor mode:** `openclaw doctor --quick` that runs only the 5-6 checks relevant to a fresh install (config validity, gateway health, auth, basic connectivity). Reserve the full 27-module suite for `openclaw doctor --full`.

9. **Doctor summary:** End with a pass/warn/fail summary table instead of sequential notes that scroll off screen.

### Important for Documentation

10. **Single canonical "start here" page:** The 14 files in docs/start/ should collapse to 3: Getting Started, Advanced Setup, CLI Reference.

### Config Reduction Targets

| Current state | Rebuild target |
|---------------|---------------|
| 1,494 config keys | ~200 documented keys in primary schema; rest in "advanced" namespace |
| 45 CLI commands | ~15 primary + `openclaw advanced <command>` for the rest |
| 27 doctor modules | 6 quick-path + 21 deep-path |
| 54 auth choices | 5 primary + "more..." |
| 14 onboarding files | 3-4 files (init, configure, channels-add, types) |

---

## Summary Ratings

| Area | Rating (1-5) | Notes |
|------|-------------|-------|
| Onboarding Flow | 3 | Competent but too many steps for first run |
| Doctor Diagnostics | 4 | Comprehensive and well-structured; needs quick mode |
| Configuration Complexity | 2 | 1,494 keys is a discoverability crisis |
| CLI Ergonomics | 2 | 45 flat commands, naming confusion |
| Error Messages | 4 | Actionable, include fix commands and docs links |
| Documentation | 3 | Thorough but too many entry points |
| First-Run Experience | 3 | Security wall + decision overload before first chat |
| Config vs Convention | 3 | Good defaults, but onboarding asks about too much upfront |

**Overall UX Score: 3.0/5** -- Functional and well-engineered for power users, but fails the "new user in 5 minutes" test due to decision overload and missing progressive disclosure.
