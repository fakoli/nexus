# Contributing to Nexus

Thank you for your interest in contributing. This document covers everything you need to get started.

---

## Setting Up the Development Environment

### Prerequisites

- Node.js 22 or later (LTS recommended)
- npm 10 or later
- A supported AI provider key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`)

### Steps

```bash
# Clone the repository
git clone https://github.com/fakoli/nexus.git
cd nexus

# Install all workspace dependencies
npm install

# Build TypeScript declarations
npm run build

# Verify the CLI works
npx tsx packages/cli/src/index.ts --version
```

---

## Running Tests

```bash
# Run the full test suite
npm test

# Run tests in watch mode during development
npx vitest

# Run tests for a specific package
npx vitest packages/core

# Type-check without emitting output
npm run typecheck

# Lint
npm run lint
npm run lint:fix
```

---

## How to Add a New Tool

Tools live in `packages/agent/src/tools/`. Each tool is a plain function registered with the tool executor.

1. Create `packages/agent/src/tools/<name>.ts` (keep it under 200 LOC).
2. Export a `register<Name>Tool()` function that calls `registerTool(definition, handler)`.
3. The definition must include a Zod schema for parameters.
4. Re-export the register function from `packages/agent/src/index.ts`.
5. Call it in `packages/gateway/src/handlers/agent.ts` alongside the existing tool registrations.
6. Add unit tests in `packages/agent/src/__tests__/`.

---

## How to Add a New Channel

Channel adapters live in `extensions/`. Each adapter is an independent workspace package.

1. `mkdir extensions/<channel>` and add a `package.json` with `"name": "@nexus/<channel>"`.
2. Implement an adapter that calls the gateway WebSocket API (connect, create a session, forward messages).
3. Register any required config keys in `packages/core/src/config.ts` if the adapter needs persistent settings.
4. Add a `README.md` in the extension directory documenting setup steps.
5. See `extensions/telegram/` or `extensions/discord/` for reference implementations.

---

## How to Add or Publish a Plugin

See [docs/plugins.md](docs/plugins.md) for the full guide. Quick summary:

1. Create a directory with `package.json` and `nexus-plugin.json`.
2. Implement the plugin entry point declared in `nexus-plugin.json "main"`.
3. Test locally with `nexus plugins install /path/to/my-plugin`.
4. Publish by adding an entry to a `registry.json` hosted at a public HTTPS URL.
5. Share the registry URL so others can add it with `nexus plugins registry add <url>`.

---

## Pull Request Guidelines

- **One concern per PR.** Bug fixes, features, and refactors should be separate PRs.
- **Keep PRs small.** Aim for fewer than 400 changed lines. Large PRs are hard to review.
- **Write tests.** New behaviour must be covered by unit tests. Bug fixes should include a regression test.
- **Update docs.** If you change a public API, CLI command, or config key, update the relevant file in `docs/`.
- **Link the issue.** Reference the GitHub issue number in the PR description (`Fixes #123`).
- **Pass CI.** All checks (type-check, lint, tests, build) must pass before merging.
- **No force-pushes to main.** Only the maintainers merge to `main`.

---

## Code Style

- **TypeScript strict mode** — `strict: true` in `tsconfig.json`. No `any`, no non-null assertions.
- **Zod for all external input** — every value crossing a trust boundary (HTTP, WS, SQLite, CLI args) must be validated with a Zod schema.
- **File size** — keep files under 200 lines. Split when a file grows beyond that.
- **Named exports only** — no default exports except for framework entry points that require them.
- **`import type`** — use `import type` for type-only imports (enforced by ESLint).
- **Formatting** — run `npx prettier --write .` before committing. The `.prettierrc` at the root configures all rules.
- **No `console.log`** — use the `createLogger` factory from `@nexus/core` instead. `console.*` is only allowed in CLI command files.

---

## Project Structure

```
nexus/
  packages/
    core/       — shared database, config, events, crypto
    agent/      — AI execution loop, providers, tools
    gateway/    — Hono HTTP + WebSocket RPC server
    cli/        — Commander.js CLI entry point
    plugins/    — plugin loader and marketplace client
    ui/         — SolidJS web interface
  extensions/
    telegram/   — Telegram channel adapter
    discord/    — Discord channel adapter
  docs/         — project documentation
  scripts/      — development and build helper scripts
```
