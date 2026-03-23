# Sprint 2 Code Review

Reviewer: Claude Code (claude-sonnet-4-6)
Date: 2026-03-22

---

## Summary of Files Reviewed

| File | LOC | Verdict |
|---|---|---|
| `packages/agent/src/commands/registry.ts` | 100 | pass |
| `packages/agent/src/commands/handlers.ts` | 379 | needs-work (critical fixed) |
| `packages/agent/src/commands/index.ts` | 15 | pass |
| `packages/core/src/security/audit-report.ts` | 171 | pass |
| `packages/ui/src/components/agents/AgentList.tsx` | 114 | needs-work (critical fixed) |
| `packages/ui/src/components/agents/AgentEditor.tsx` | 167 | needs-work (critical fixed) |
| `packages/ui/src/components/agents/BootstrapEditor.tsx` | 142 | pass |
| `packages/ui/src/stores/agent-actions.ts` | 105 | needs-work (critical fixed) |
| `packages/ui/src/components/chat/ToolCard.tsx` | 188 | pass (XSS reviewed, safe) |
| `packages/ui/src/components/chat/MessageActions.tsx` | 92 | pass |
| `packages/ui/src/stores/chat-state.ts` | 82 | pass |
| `packages/ui/src/components/sessions/SessionTuning.tsx` | 166 | pass |
| `packages/ui/src/components/sessions/SessionFilters.tsx` | 144 | pass |
| `packages/ui/src/stores/session-tuning.ts` | 99 | pass |
| `packages/ui/src/components/shared/FocusMode.tsx` | 87 | pass |
| `packages/gateway/src/handlers/chat.ts` | 119 | pass |
| `packages/ui/src/App.tsx` | 111 | pass |
| `packages/ui/src/stores/actions.ts` | 173 | needs-work (fixed) |

---

## Critical Issues (Fixed)

### 1. agent-actions.ts — Wrong parameter shape for agents.create and agents.update

**Severity: Critical (runtime bug — all agent create/update calls fail)**

`createAgent` and `updateAgent` were sending a flat payload `{ id, ...config }`, but the
gateway handlers (`AgentsCreateParams`, `AgentsUpdateParams` in `packages/gateway/src/handlers/agents.ts`)
expect a nested shape `{ id, config: { ... } }`. Every call through the UI would have been
rejected by Zod validation with `INVALID_PARAMS`.

Fixed in `packages/ui/src/stores/agent-actions.ts`:
- `createAgent`: `{ id, ...config }` → `{ id, config }`
- `updateAgent`: `{ id, ...config }` → `{ id, config }`

### 2. handlers.ts /debug command — API keys and tokens exposed in chat

**Severity: Critical (security — credential exfiltration)**

The `/debug` slash command called `getAllConfig()` and dumped the entire config object into the
chat response. `NexusConfig` includes:
- `security.gatewayToken`
- `security.gatewayPassword`
- `channels.telegram.token`
- `channels.discord.token`

Any user with chat access could run `/debug` to obtain all gateway credentials and channel bot
tokens. The gateway's own authentication token would be leaked to an authenticated session —
a privilege escalation / secret exfiltration path if sessions can be shared or captured.

Fixed in `packages/agent/src/commands/handlers.ts`: the debug handler now builds a safe copy
of the config with all known secret fields replaced with `"[REDACTED]"` before serialising.

### 3. AgentEditor.tsx — CSS border shorthand overrides border-bottom

**Severity: Critical (visual regression — active tab indicator never renders)**

`tabStyle` had the following property order:

```
"border-bottom": `2px solid ${active ? t.color.accent : "transparent"}`,
...
border: "none",
"border-bottom-color": active ? t.color.accent : "transparent",
```

The `border: "none"` shorthand resets all border sub-properties including `border-bottom-style`
to `none`, making the bottom border invisible regardless of `border-bottom-color`. The intended
active-tab underline indicator was never shown.

Fixed: reordered to `border: "none"` first (reset all borders), then `"border-bottom": ...`
(re-apply only the bottom border). The redundant `"border-bottom-color"` property was removed.

### 4. AgentList.tsx — Non-null assertion operator used on signal value

**Severity: Critical (violates project strict-mode rule, runtime crash risk)**

`CLAUDE.md` explicitly forbids non-null assertions (`!`). Line 108 used `confirmDelete()!` to
pass the confirmed agent ID to `handleDelete`. Although the button is only rendered when
`confirmDelete() !== null`, SolidJS reactivity does not narrow the signal type here, and the
`!` still bypasses the type system.

Fixed: replaced with a conditional `const id = confirmDelete(); if (id) void handleDelete(id);`
which satisfies strict TypeScript without assertions.

### 5. actions.ts — Orphaned duplicate JSDoc comment

**Severity: Low (dead code / documentation confusion)**

Two consecutive JSDoc blocks appeared before `initGateway` — the first described
`connectAndAuthenticate` and had been left behind when the function order was changed.
TypeScript associates a JSDoc block with the declaration immediately following it, so the
`connectAndAuthenticate` description was silently discarded and replaced by the second block.

Fixed: the orphaned first block removed.

---

## Warnings (Not Fixed — for Later)

### W1. handlers.ts — `log` logger is declared but barely used

`createLogger("agent:command-handlers")` is called at module level, but only one of the 24
command handlers (`/new`) actually calls `log.info`. The other 23 handlers perform operations
silently. This makes operational debugging difficult. Recommended: add `log.debug` calls to
state-mutating commands at minimum (`/model`, `/provider`, `/think`, `/config set`, `/memo`).

### W2. handlers.ts — 379 LOC exceeds the 200-line project limit

`CLAUDE.md` states "Keep files under 200 lines." At 379 lines the file exceeds this by nearly
2x. Consider splitting into `handlers/session.ts`, `handlers/model.ts`, `handlers/agent.ts`,
`handlers/tools.ts` with a barrel `handlers/index.ts` that imports all four.

### W3. agent-actions.ts / actions.ts — `err as Error` unsafe cast used 13 times

Both store action files catch errors with `catch (err)` and then cast immediately with
`(err as Error).message`. While gateway promise rejections will virtually always be `Error`
instances, `CLAUDE.md` mandates narrowing with `err instanceof Error`. If a non-Error rejection
ever occurs, `.message` will be `undefined`, storing `undefined` as the connection error.

Pattern to apply everywhere:
```typescript
setStore("connection", "error", err instanceof Error ? err.message : String(err));
```

This affects all 13 catch blocks across the two files.

### W4. session-tuning.ts — `initTuningFromConfig` uses unsafe `as ThinkLevel` cast

Line 97: `cfg.thinkLevel as ThinkLevel` bypasses validation. If the server returns an
unexpected string (e.g. `"none"` — which the agent's own options use vs `"off"` in the
tuning store), the cast silently stores an invalid value. Use a type guard:

```typescript
const THINK_LEVELS: ThinkLevel[] = ["off", "low", "medium", "high"];
if (cfg.thinkLevel && (THINK_LEVELS as string[]).includes(cfg.thinkLevel)) {
  setTuningStore("thinkLevel", cfg.thinkLevel as ThinkLevel);
}
```

Note also: `AgentEditor.tsx` uses `"none"` as the default `thinkLevel` value for its local
state, while `session-tuning.ts` and `handlers.ts` both use `"off"`. These must be aligned.

### W5. ToolCard.tsx — innerHTML usage lacks a comment explaining XSS safety

Line 161 uses `innerHTML={highlightJson(...)}` (SolidJS's equivalent of
`dangerouslySetInnerHTML`). The `highlightJson` function does correctly escape `&`, `<`, `>`
before running the regex, and the `cls` variable is always a hardcoded CSS string — so this is
safe. However, the safety is non-obvious to future maintainers. A brief comment should be added
above the `innerHTML` explaining why it is safe (server content is HTML-escaped prior to
wrapping in `<span>` tags; the `cls` string is never user-supplied).

### W6. AgentEditor.tsx — local state not initialised from the current agent config

Signals for `provider`, `model`, and `temperature` are initialised once from `agent()` on
component mount via `createSignal(agent()?.provider ?? "anthropic")`. If `selectedAgentId`
changes (user clicks a different agent card), the signals are not reset and will display stale
values from the previous agent. Use `createMemo` or a `createEffect` that watches
`props.agentId` to re-initialise the form fields.

### W7. SessionFilters.tsx — `state` and `sort` selects use unchecked string casts

Lines 80 and 93 use `e.currentTarget.value as StateFilter` and `e.currentTarget.value as SortKey`.
These are driven by hardcoded `<option>` elements so the values are always valid in practice,
but the casts bypass `strict` mode. A runtime check or Zod enum parse would be more defensive.

### W8. FocusMode.tsx — keydown listener registered even when inactive

`window.addEventListener("keydown", handleKey)` is registered unconditionally on `onMount`
and only cleaned up on `onCleanup`. When `active` is `false` the listener still fires on every
keypress (the check `if (e.key === "Escape" && props.active)` is a no-op guard, not a
registration guard). For a long-lived component this is harmless, but for a component that
could be mounted and unmounted repeatedly it wastes event handling cycles. This is acceptable
as-is but worth noting.

---

## Per-File Verdicts

### packages/agent/src/commands/registry.ts — PASS

Clean. Well-structured registration/dispatch pattern. Error handling in `executeSlashCommand`
is correct — catches unknown errors and narrows with `err instanceof Error`. Types are explicit
and tight. Under 200 LOC. No `any` usage.

### packages/agent/src/commands/handlers.ts — NEEDS-WORK (critical fixed)

The `/debug` security issue has been fixed. Remaining warnings: file is 379 LOC (W2), logger
barely used (W1). Functionally the handlers are well-written; the `/config set` JSON.parse
catch is acceptably handled with a comment.

### packages/agent/src/commands/index.ts — PASS

Correct barrel-export + side-effect import pattern. Clean.

### packages/core/src/security/audit-report.ts — PASS

Well-structured. Each check is a named pure function. Score computation is transparent. No
`any`, no unsafe casts. `fs.existsSync` / `fs.statSync` used appropriately for the key-file
check. Under 200 LOC.

### packages/ui/src/components/agents/AgentList.tsx — NEEDS-WORK (critical fixed)

Non-null assertion fixed. Otherwise clean SolidJS component. Lifecycle (`onMount`) used
correctly. Error state is shown implicitly via the store's connection error; would benefit from
a local error display but this is a pattern consistent with the rest of the UI codebase.

### packages/ui/src/components/agents/AgentEditor.tsx — NEEDS-WORK (critical fixed)

CSS `tabStyle` conflict fixed. Warning W6 (stale form state on agent change) remains.

### packages/ui/src/components/agents/BootstrapEditor.tsx — PASS

`createEffect` for auto-loading on file switch is correct. Loading/saving state well handled.
Preview mode uses SolidJS text interpolation (not innerHTML) so no XSS concern. Clean.

### packages/ui/src/stores/agent-actions.ts — NEEDS-WORK (critical fixed)

Parameter shape bug for `agents.create` and `agents.update` fixed. Warning W3 (`err as Error`
cast) remains — consistent with rest of store files but should be addressed in a follow-up.

### packages/ui/src/components/chat/ToolCard.tsx — PASS

XSS analysis: `highlightJson` escapes `&`, `<`, `>` in the full raw string before running the
replacement regex, so `match` captured from the escaped string cannot contain raw HTML-
breaking characters. The `cls` value in `style="${cls}"` is always one of four hardcoded color
strings, never user-supplied. The `innerHTML` usage is safe. Warning W5 (add safety comment)
applies.

### packages/ui/src/components/chat/MessageActions.tsx — PASS

Clean. Reads from `chat-state` signals correctly. `btnStyle` helper returns plain
`Record<string, string>` rather than `JSX.CSSProperties` — minor inconsistency with other
components but not a bug.

### packages/ui/src/stores/chat-state.ts — PASS

localStorage persistence with error handling. Correct SolidJS signal patterns. `loadSet` and
`saveSet` both have try/catch. Clean.

### packages/ui/src/components/sessions/SessionTuning.tsx — PASS

Good progressive-disclosure UX. Store bindings correct. Under 200 LOC.

### packages/ui/src/components/sessions/SessionFilters.tsx — PASS

Clean presentational component with no side effects. Pagination logic is correct (page resets
to 0 on filter changes via `set()`, direct page changes via `setPage()`). Warning W7 applies.

### packages/ui/src/stores/session-tuning.ts — PASS

Well-typed store with explicit `keyof` generic on `setTuning`. `getTuningParams()` cleanly
separates the store from what goes on the wire. Warning W4 (`as ThinkLevel` cast in
`initTuningFromConfig`) applies.

### packages/ui/src/components/shared/FocusMode.tsx — PASS

Simple overlay pattern. `onMount`/`onCleanup` symmetry correct. Escape key handling correct.
Warning W8 (always-attached listener) is low priority.

### packages/gateway/src/handlers/chat.ts — PASS

Follows the existing gateway handler pattern exactly. Zod validation on both handlers. Session
existence checked before use. Slash command interception is clean — falls through to normal
message append when not handled. Consistent with `sessions.ts` and `agents.ts` patterns.

### packages/ui/src/App.tsx — PASS

Clean routing via SolidJS `Switch`/`Match`. Correct `onMount`/`onCleanup` for global key
listener. `BootstrapEditor` state management (`showBootstrap`, `selectedAgentId`) scoped at
the right level. No `any`, no non-null assertions.

### packages/ui/src/stores/actions.ts — NEEDS-WORK (fixed)

Orphaned duplicate JSDoc removed. Warning W3 (`err as Error` cast) present but consistent with
Sprint 1 codebase pattern.

---

## Overall Verdict

**Sprint 2 is not ready to ship as-was. Five critical issues have been fixed directly in the
source files. The most impactful were the `agents.create`/`agents.update` parameter mismatch
(all agent management was silently broken) and the `/debug` secret exfiltration.**

After the applied fixes, Sprint 2 is functionally correct. Eight warnings remain for follow-up
work; none are showstoppers. The highest priority follow-up is W3 (the `err as Error` casts,
13 occurrences across the store layer) and W2 (splitting `handlers.ts` before it grows
further).

### Applied Fixes

| File | Fix |
|---|---|
| `packages/ui/src/stores/agent-actions.ts` | `agents.create` / `agents.update` — flatten → nested `config` key |
| `packages/agent/src/commands/handlers.ts` | `/debug` — redact `gatewayToken`, `gatewayPassword`, channel tokens |
| `packages/ui/src/components/agents/AgentEditor.tsx` | `tabStyle` — `border` shorthand before `border-bottom` |
| `packages/ui/src/components/agents/AgentList.tsx` | `confirmDelete()!` → null-safe conditional |
| `packages/ui/src/stores/actions.ts` | Remove orphaned duplicate JSDoc block |
