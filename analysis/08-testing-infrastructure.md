# 08 - Testing Infrastructure

**Date**: 2026-03-22
**Codebase**: OpenClaw (openclaw/openclaw)
**Scope**: Test framework, CI/CD pipelines, coverage, Docker testing, security scanning, pre-commit hooks

---

## Executive Summary

OpenClaw has an exceptionally mature and sophisticated testing infrastructure. The codebase contains **~2,806 test files** covering a **~4,419-file TypeScript source base** (src + extensions + UI), yielding a ~63% file-level test-to-source ratio. The test runner is Vitest, but the project has outgrown a single-config execution model: a custom parallel orchestrator (`scripts/test-parallel.mjs`) partitions the suite into isolated lanes based on memory hotspot manifests and behavioral metadata, running multiple Vitest processes concurrently. CI spans Linux (16-vCPU Blacksmith runners with 2-shard splits), Windows (32-vCPU with 6-shard splits), and macOS, alongside Docker smoke tests, install-script E2E tests, Parallels VM smoke tests (Linux/macOS/Windows guests), and platform-native Swift/Kotlin test suites. Secret detection, pre-commit hooks (10 hooks), GitHub Actions linting, and CodeQL scanning form a layered security gate. The system is well-documented in AGENTS.md with hard-won operational guardrails (worker caps, pool selection, memory pressure profiles).

**Overall Rating: 4.5 / 5** -- Among the most thorough testing setups in a TypeScript open-source project, with some complexity cost.

---

## Scope

This analysis covers:
- All 9 Vitest configuration files (root + scoped)
- The custom parallel test runner and its supporting manifests
- CI/CD pipeline (`ci.yml` and 10 additional workflow files)
- Docker testing infrastructure (7 Dockerfiles)
- Pre-commit hooks (`.pre-commit-config.yaml`)
- Secret detection (`.detect-secrets.cfg`, `.secrets.baseline`)
- Test helpers and mocks (`test/`, `src/test-helpers/`, `src/test-utils/`)
- E2E test harness (`scripts/e2e/`)
- Operational guardrails documented in AGENTS.md

---

## Detailed Findings

### 1. Test Framework and Configuration Architecture (Rating: 5/5)

**Framework**: Vitest with V8 coverage provider.

**Why 9+ config files**: The suite is too large and heterogeneous for a single Vitest invocation. Each config file targets a distinct domain with its own include/exclude patterns, worker counts, and pool settings:

| Config File | Purpose | Include Scope | Special Settings |
|---|---|---|---|
| `vitest.config.ts` | Base config (shared by all) | `src/**`, `extensions/**`, `test/**`, select `ui/` files | pool: forks, coverage thresholds, alias resolution |
| `vitest.unit.config.ts` | Unit tests only | `src/**` + `test/**` (excl. gateway, extensions, channels) | Env-driven include/exclude via JSON files |
| `vitest.e2e.config.ts` | End-to-end tests | `**/*.e2e.test.ts` | pool: forks, max 16 workers, `OPENCLAW_E2E_WORKERS` override |
| `vitest.gateway.config.ts` | Gateway subsystem | `src/gateway/**/*.test.ts` | Uses `createScopedVitestConfig` helper |
| `vitest.channels.config.ts` | Channel integrations | telegram, discord, whatsapp, slack, signal, imessage, browser, line | Excludes `src/gateway/**` |
| `vitest.extensions.config.ts` | Plugin extensions | `extensions/**/*.test.ts` | Excludes channel test roots |
| `vitest.live.config.ts` | Live API tests (real keys) | `**/*.live.test.ts` | maxWorkers: 1, sequential |
| `ui/vitest.config.ts` | UI (Playwright browser) | unit, unit-node, browser projects | jsdom + Playwright chromium |
| `ui/vitest.node.config.ts` | UI pure logic (no browser) | `**/*.node.test.ts` | environment: node |

**Key architecture insight**: `vitest.scoped-config.ts` provides a `createScopedVitestConfig()` factory that inherits the base config and overrides only include/exclude. This keeps domain configs DRY (3-6 lines each).

**Path resolution helpers**: `vitest.unit-paths.mjs` and `vitest.channel-paths.mjs` centralize glob patterns so both the Vitest configs and the parallel runner can reference identical file lists.

**Worker management**: The base config caps local workers at `Math.max(4, Math.min(16, os.cpus().length))` and CI at 2-3 workers. The AGENTS.md explicitly warns: "Do not set test workers above 16; tried already."

**Pool selection**: The codebase has migrated from `vmForks` to `forks` due to documented OOM evidence. `vmForks` caused module-state leaks and memory pressure. The base config enables `unstubEnvs: true` and `unstubGlobals: true` to prevent cross-test pollution.

### 2. Coverage Thresholds (Rating: 4/5)

Defined in `vitest.config.ts`:

```
thresholds:
  lines: 70%
  functions: 70%
  branches: 55%
  statements: 70%
```

**Coverage scope**: `all: false` -- only counts files exercised by the test suite. Coverage is anchored to `./src/**/*.ts` only.

**Extensive exclusion list**: ~50 paths/patterns are excluded from coverage, including:
- Entrypoints (`entry.ts`, `index.ts`, `runtime.ts`)
- CLI/TUI/wizard flows (validated via manual/e2e)
- Gateway server methods (integration-tested)
- Agent integrations (e2e/manual)
- Process bridges, sandbox, browser surfaces
- State migrations, tailscale, outbound sessions

**iOS coverage**: Separately gated at 43% in CI (`ios` job).

**Concern**: The 55% branch threshold is relatively low. The extensive exclusion list means the effective coverage denominator is much smaller than the full `src/` tree. However, this is a pragmatic choice given the integration-heavy nature of many modules.

### 3. Test Organization (Rating: 5/5)

**Pattern**: Colocated `*.test.ts` files alongside source. E2E tests use `*.e2e.test.ts`, live tests use `*.live.test.ts`.

**File counts by module**:

| Module | Test Files | Source Files | Ratio |
|---|---|---|---|
| `src/` total | 2,047 | 2,928 | 70% |
| `src/agents` | 464 | 478 | 97% |
| `src/infra` | 262 | 242 | 108% |
| `src/gateway` | 160 | 230 | 70% |
| `src/commands` | 165 | 250 | 66% |
| `src/cli` | 114 | 197 | 58% |
| `src/config` | 107 | 147 | 73% |
| `src/channels` | 75 | 125 | 60% |
| `src/plugins` | 76 | 134 | 57% |
| `src/browser` | 60 | 98 | 61% |
| `src/memory` | 40 | 66 | 61% |
| `extensions/` | 672 | 1,335 | 50% |
| `ui/` | 60 | 156 | 38% |
| `test/` (standalone) | 27 | -- | -- |

**Standouts**: `src/agents` (97% ratio) and `src/infra` (108% -- more test files than source) are exceptionally well-tested. The UI layer (38%) and extensions (50%) are less dense but still meaningful.

**Total**: ~2,806 test files, ~38 E2E tests, ~15 live tests.

### 4. Test Helpers and Infrastructure (Rating: 5/5)

The project has three tiers of test support code:

**Tier 1: Global setup (`test/setup.ts`, `test/test-env.ts`, `test/global-setup.ts`)**
- `test/test-env.ts`: Creates an isolated temp `HOME` directory per worker. Saves and restores ~20 environment variables. Deletes all channel tokens, GitHub tokens, and NODE_OPTIONS to prevent leaks from developer environments into test runs.
- `test/setup.ts`: Mocks `@mariozechner/pi-ai` OAuth (avoids real auth in tests). Installs a default `PluginRegistry` with stub channel plugins (Discord, Slack, Telegram, WhatsApp, Signal, iMessage). Uses a lazy `Proxy` so suites that never touch the registry pay zero allocation cost. Restores registry + fake timers after each test.
- `test/global-setup.ts`: Lightweight wrapper invoking `installTestEnv()`.

**Tier 2: Test helpers (`test/helpers/`, 13 files)**
- `gateway-e2e-harness.ts` (383 lines): Full gateway lifecycle helper -- spawns a real gateway subprocess, waits for port, connects WebSocket clients, sends JSON payloads, polls node status, waits for chat events. Manages per-instance temp home dirs with cleanup.
- `temp-home.ts` (153 lines): `withTempHome()` utility for isolated per-test HOME environments with Windows support.
- `auth-wizard.ts`: Mock `WizardPrompter` factory with configurable overrides.
- Other helpers: `envelope-timestamp.ts`, `fast-short-timeouts.ts`, `http-test-server.ts`, `import-fresh.ts`, `memory-tool-manager-mock.ts`, `mock-incoming-request.ts`, `normalize-text.ts`, `paths.ts`, `poll.ts`, `wizard-prompter.ts`.

**Tier 3: Shared test utilities (`src/test-helpers/`, `src/test-utils/`, ~66 files)**
- Workspace scaffolding (`workspace.ts`, `temp-dir.ts`)
- Channel plugin test fixtures and mock HTTP responses
- Environment capture/restore (`env.ts`)
- Port allocation (`ports.ts`)
- Command runner for CLI testing
- Typed test cases helper
- SSRF test helpers
- Model auth mocks, provider usage fetch helpers

**Tier 4: Domain-specific mocks (`test/mocks/`)**
- `baileys.ts`: Full mock of `@whiskeysockets/baileys` (WhatsApp library) with event emitters, socket management, and auth state.

**Test fixtures (`test/fixtures/`, 10+ files)**
- `test-parallel.behavior.json` (16.5K): Per-file behavioral manifest specifying which tests need isolated processes, singleton workers, or vmFork mode.
- `test-timings.unit.json` (28.6K): Timing data for test file packing/scheduling.
- `test-memory-hotspots.unit.json` (5.7K): Memory hotspot data for heap-safe lane assignment.
- Various contract/boundary fixture JSONs.

### 5. Custom Parallel Test Runner (Rating: 5/5)

`scripts/test-parallel.mjs` is the entry point for `pnpm test`. This is a sophisticated custom orchestrator that goes far beyond Vitest's built-in parallelism:

**Core capabilities**:
- **Multi-lane execution**: Splits the test suite into multiple Vitest processes (unit-fast, gateway, channels, extensions, plus isolated file lanes).
- **Behavioral manifest**: `test/fixtures/test-parallel.behavior.json` specifies per-file isolation requirements (isolated, singletonIsolated, threadSingleton, vmForkSingleton) with documented reasons for each entry.
- **Timing-based packing**: Uses `test-timings.unit.json` to pack test files into balanced shard buckets (`packFilesByDuration`).
- **Memory hotspot tracking**: `test-memory-hotspots.unit.json` identifies files that cause excessive heap growth. The runner assigns these to separate processes.
- **CI sharding**: Supports `OPENCLAW_TEST_SHARDS` and `OPENCLAW_TEST_SHARD_INDEX` for CI matrix splitting (2 shards on Linux, 6 on Windows).
- **Profile support**: `OPENCLAW_TEST_PROFILE` accepts `low`, `macmini`, `max`, `normal`, `serial` for different host capabilities.
- **Memory monitoring**: Integrates `test-parallel-memory.mjs` for RSS sampling during runs.
- **Platform awareness**: Detects CI vs local, Mac Studio vs Mac Mini, Windows vs macOS vs Linux, adjusts concurrency accordingly.

### 6. CI/CD Pipeline (Rating: 5/5)

**Main CI (`ci.yml`, ~1000 lines)**:

The CI is a production-grade pipeline with:

**Smart scope detection**:
- `docs-scope` job: Detects docs-only changes to skip heavy jobs entirely.
- `changed-scope` job: Detects which subsystems changed (Node, macOS, Android, Python, Windows) using `scripts/ci-changed-scope.mjs`.
- `changed-extensions` job: Detects which specific extensions changed for targeted fast-lane testing.

**Test matrix** (Linux, `checks` job):

| Lane | Description |
|---|---|
| test shard 1/2 | Unit tests, first half |
| test shard 2/2 | Unit tests, second half |
| extensions | All extension tests |
| channels | Channel integration tests |
| contracts | Channel + plugin contract tests |
| protocol | Protocol compliance check |
| bun test | Unit tests under Bun runtime (push-only) |
| compat-node22 | Build + smoke test on Node 22 (push-only) |

**Additional CI jobs**:
- `extension-fast`: Dynamic matrix running only changed extensions' tests.
- `check`: TypeScript + Oxlint + Oxfmt + strict build smoke.
- `check-additional`: 7 boundary/regression guards (plugin boundaries, web search provider boundaries, extension SDK boundaries, safe URL opening, gateway watch regression, config docs drift).
- `build-smoke`: CLI help, status, bundled plugin singleton, startup memory check.
- `secrets`: Pre-commit detect-private-key + zizmor workflow audit + pnpm audit.
- `check-docs`: Docs format/lint/links (only when docs changed).
- `skills-python`: Ruff lint + pytest for Python skill scripts.

**Windows CI** (`checks-windows`): 6-shard matrix with 1 worker per shard, Windows Defender exclusions, 45-minute timeout.

**macOS CI** (`macos`): Single consolidated job (to fit macOS runner limits): TS tests + Swift lint + build (release) + test + code coverage.

**Android CI** (`android`): 4-matrix (Play/ThirdParty x test/build), Gradle + SDK setup.

**Other workflows** (10 additional .yml files):
- `install-smoke.yml`: Docker build + install script smoke tests.
- `docker-release.yml`: GHCR image build/push with manual backfill support.
- `sandbox-common-smoke.yml`: Validates sandbox Docker images.
- `workflow-sanity.yml`: Actionlint + tab detection + composite action input validation.
- `codeql.yml`: CodeQL SAST for JS/TS, Python, Java/Kotlin, Swift, Actions.
- `openclaw-npm-release.yml`: npm publish pipeline.
- `plugin-npm-release.yml`: Extension npm publish pipeline.
- `auto-response.yml`: Automated PR/issue triage.
- `stale.yml`: Stale issue/PR management.
- `labeler.yml`: Auto-labeling based on file paths.

**Runners**: Primarily Blacksmith 16-vCPU Ubuntu 24.04 (faster than GitHub-hosted). macOS uses `macos-latest`. Windows uses Blacksmith 32-vCPU.

### 7. Docker Testing Infrastructure (Rating: 4/5)

**Production Dockerfile** (`Dockerfile`, 253 lines):
- Multi-stage build: ext-deps -> build -> runtime-assets -> runtime.
- Pinned to SHA256 digests for reproducibility.
- Two variants: full bookworm and bookworm-slim.
- Optional Chromium/Playwright install, Docker CLI install.
- Security hardening: runs as `node` user (uid 1000).
- HEALTHCHECK on `/healthz`.

**Sandbox Dockerfiles**:
- `Dockerfile.sandbox`: Minimal Debian bookworm-slim with bash, curl, git, python3, ripgrep. Runs as `sandbox` user.
- `Dockerfile.sandbox-browser`: Adds Chromium, Xvfb, noVNC, x11vnc for browser automation. Exposes CDP (9222), VNC (5900), noVNC (6080).
- `Dockerfile.sandbox-common`: Layered on sandbox base. Adds Node, npm, pnpm, Bun, Go, Rust, Homebrew.

**E2E Docker** (`scripts/e2e/Dockerfile`): Full build environment for running E2E tests in containers. Copies test fixtures, scripts, and docs. Creates stub Control UI.

**Docker E2E scripts** (`scripts/e2e/`, 10 files):
- `onboard-docker.sh` (17K): Full onboarding flow E2E in Docker.
- `plugins-docker.sh` (12.5K): Plugin install/runtime E2E.
- `parallels-linux-smoke.sh` (20K), `parallels-macos-smoke.sh` (33K), `parallels-windows-smoke.sh` (28K): Cross-platform VM smoke tests via Parallels.
- `gateway-network-docker.sh`, `doctor-install-switch-docker.sh`, `qr-import-docker.sh`.

### 8. Pre-commit Hooks (Rating: 5/5)

`.pre-commit-config.yaml` defines **15 hooks** across 6 repos:

**File hygiene** (pre-commit-hooks v6.0.0):
- trailing-whitespace, end-of-file-fixer (exclude docs/dist/vendor/snaps)
- check-yaml (multi-document)
- check-added-large-files (max 500KB)
- check-merge-conflict
- detect-private-key

**Secret detection** (detect-secrets v1.5.0):
- Baseline file: `.secrets.baseline`
- Extensive exclusion patterns (17 `--exclude-lines` rules) for schema labels, docs examples, test fixtures, Sparkle signatures.
- Excludes `pnpm-lock.yaml` and specific test files.

**Shell linting** (shellcheck v0.11.0): Error-severity only, excludes vendor/e2e scripts.

**GitHub Actions linting** (actionlint v1.7.10): All workflow files.

**GitHub Actions security audit** (zizmor v1.22.0): Medium+ severity/confidence, persona=regular.

**Python linting** (ruff v0.14.1): Skills scripts only, with project pyproject.toml config.

**Python tests**: `pytest -q skills` on skills Python files.

**Local project hooks**:
- `pnpm audit --prod --audit-level=high`
- `oxlint --type-aware src test`
- `oxfmt --check src test`
- `swiftlint`
- `swiftformat --lint`

### 9. Secret Detection (Rating: 4/5)

**`.detect-secrets.cfg`**: Documentation file defining exclusion patterns. Note: detect-secrets does not read this file by default; patterns must be wired into scan commands or baseline filters.

**`.secrets.baseline`**: Active baseline used by the pre-commit hook. Contains known false positives so new secrets are flagged but known patterns pass.

**Exclusion strategy**: The 17 `--exclude-lines` patterns in `.pre-commit-config.yaml` are carefully crafted to avoid false positives from:
- Schema labels containing "apiKey", "password"
- TypeScript typeof checks (`=== "string"`)
- Documentation examples with placeholder keys
- Sparkle appcast signing metadata
- Docker apt key fingerprint constants

### 10. E2E Testing (Rating: 4/5)

**Vitest E2E** (`vitest.e2e.config.ts`):
- Inherits base config but includes only `**/*.e2e.test.ts` patterns.
- Pool: forks (not vmForks) for deterministic isolation.
- Default 1 worker locally, `min(2, floor(cpus * 0.25))` in CI.
- Overridable via `OPENCLAW_E2E_WORKERS` (capped at 16).
- ~38 E2E test files spanning CLI, gateway, sandbox, onboarding.

**Gateway E2E harness** (`test/helpers/gateway-e2e-harness.ts`):
- Spawns real gateway processes with ephemeral ports.
- Creates isolated config/state directories per instance.
- Connects WebSocket clients via `GatewayClient`.
- Supports multi-gateway scenarios (`test/gateway.multi.e2e.test.ts`).
- Waits for port open, node status, and chat final events with configurable timeouts.

**Docker E2E scripts**: Comprehensive bash scripts that build Docker images and run full workflow scenarios:
- Onboarding flow (install, configure, first-message)
- Plugin lifecycle (install, enable, test, uninstall)
- Gateway networking
- QR code import
- Cross-platform Parallels smoke tests

**Live tests** (`vitest.live.config.ts`):
- Requires real API keys (`CLAWDBOT_LIVE_TEST=1` or `LIVE=1`).
- Runs sequentially (maxWorkers: 1).
- 15 live test files.
- Docker wrappers: `test:docker:live-models`, `test:docker:live-gateway`.

### 11. Known Issues and Operational Guardrails (Rating: 5/5)

The AGENTS.md and CLAUDE.md contain battle-tested guardrails:

1. **Worker cap**: "Do not set test workers above 16; tried already." The `vitest.config.ts` enforces `Math.min(16, ...)`.
2. **Pool selection**: "Do not switch CI `pnpm test` lanes back to Vitest `vmForks` by default without fresh green evidence on current `main`; keep CI on `forks` unless explicitly re-validated." Linked to PR #51145 with OOM evidence.
3. **Memory pressure**: `OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test` for constrained hosts. The parallel runner detects Mac Studio (96GB+) vs Mac Mini (<64GB) hosts.
4. **Windows instability**: Windows shard 2 has "shown intermittent instability at 2 workers" -- CI uses 1 worker on Windows.
5. **Test runner wrapper**: "Do not default to raw `pnpm vitest run ...` because it bypasses wrapper config/profile/pool routing."
6. **Behavioral manifest**: Individual test files are documented with reasons for isolation (e.g., "Mutates process.cwd()", "Touches process-level unhandledRejection listeners", "retained nearly 1 GiB in unit-fast").

---

## Cross-References

| Topic | Related Analyses |
|---|---|
| Gateway tests | `01-gateway-core.md` -- gateway server-methods and protocol tests |
| Channel tests | `02-channels-plugins.md` -- channel plugin contracts and extension boundary tests |
| Agent tests | `03-agent-runtime.md` -- agent sandbox E2E and tool testing |
| UI tests | `04-web-ui.md` -- Playwright browser tests, jsdom unit tests |
| Native app tests | `05-native-apps.md` -- Swift/Kotlin test suites in CI |
| Security tests | `06-security-model.md` -- secret detection, boundary guards, SSRF helpers |

---

## Rebuild Implications

### Effort to Reproduce (High)

The testing infrastructure is the result of significant iterative investment:

1. **Custom parallel runner**: `test-parallel.mjs` (~500+ lines) with supporting manifests, memory profiling, and timing data is a custom solution to Vitest scaling limits. A rebuild would require either:
   - Replicating the multi-lane orchestration approach
   - Waiting for Vitest to mature its built-in project/shard support
   - Migrating to a test runner with native multi-project support (Jest workspaces, Nx)

2. **Behavioral manifests**: The `test-parallel.behavior.json`, `test-timings.unit.json`, and `test-memory-hotspots.unit.json` files represent months of profiling data. Scripts exist to regenerate timing/memory data (`test:perf:update-timings`, `test:perf:update-memory-hotspots`).

3. **CI pipeline**: The 1000+ line `ci.yml` with smart scope detection, platform matrices, and artifact sharing represents substantial DevOps investment.

4. **Test isolation**: The `test/setup.ts` + `test/test-env.ts` combo (combined ~400 lines) implements a battle-tested isolation strategy for HOME, env vars, and plugin registries.

### Key Risks

1. **Vitest version upgrades**: The pool/worker configuration is tightly coupled to Vitest internals. Major Vitest upgrades may require re-profiling the entire behavioral manifest.
2. **Runner costs**: 16-vCPU Blacksmith runners x multiple shards x multiple platforms is expensive. Windows alone uses 6 shards.
3. **Complexity**: The gap between "run one test" (simple) and "run the full suite" (custom orchestrator + manifests + profiles) is large. New contributors may struggle with test infrastructure debugging.
4. **Coverage exclusions**: The 50+ coverage exclusions mean the 70% threshold applies to a relatively narrow slice of `src/`. True coverage of the full codebase is likely lower.

### What Would Transfer to a Rebuild

- The colocated `*.test.ts` pattern is a portable best practice
- The test environment isolation approach (`withIsolatedTestHome`, env capture/restore)
- The behavioral manifest concept (per-file isolation requirements)
- The CI scope detection pattern (skip heavy jobs for docs-only changes)
- The pre-commit hook selection and secret detection configuration
- The gateway E2E harness architecture (spawn process, wait for port, connect WebSocket)

---

## Summary Ratings

| Area | Rating | Notes |
|---|---|---|
| Test Framework Config | 5/5 | Elegantly factored 9-config system with shared base |
| Coverage | 4/5 | Pragmatic thresholds; extensive exclusions are honest but reduce effective coverage |
| Test Organization | 5/5 | ~2,806 test files with 63% overall file ratio; 97% in agents |
| Test Helpers | 5/5 | Three-tier helper system with lazy proxy pattern for zero-cost defaults |
| Custom Runner | 5/5 | Unique in open-source; solves real scaling problems with empirical data |
| CI/CD | 5/5 | Multi-platform, scope-aware, artifact-sharing, security-gated |
| Docker Testing | 4/5 | Comprehensive but heavy; Parallels scripts are impressive but complex |
| Pre-commit Hooks | 5/5 | 15 hooks covering code, security, actions, Swift, Python |
| Secret Detection | 4/5 | Well-configured but `.detect-secrets.cfg` is documentation-only (not auto-consumed) |
| E2E Testing | 4/5 | Strong gateway E2E; Docker scripts are thorough but bash-heavy |
| Operational Docs | 5/5 | Battle-tested guardrails with linked evidence |

**Overall: 4.5/5**
