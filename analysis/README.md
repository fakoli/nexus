# OpenClaw Competitive Analysis — Master Index

> **Project:** Clean-room rebuild of a personal AI assistant, informed by exhaustive analysis of the OpenClaw codebase (~10K files)
> **Status:** In Progress
> **Started:** 2026-03-21

## Analysis Documents

### Core Architecture (Pass 1 — Complete)
| # | Document | Status | Summary |
|---|----------|--------|---------|
| 01 | [Gateway & Core](01-gateway-core.md) | Complete | WebSocket control plane, config, sessions, routing, bootstrap |
| 02 | [Channels & Plugins](02-channels-plugins.md) | Complete | Channel adapter pattern, plugin SDK, 75+ extensions |
| 03 | [Agent Runtime](03-agent-runtime.md) | Complete | Pi agent, auto-reply, 82 tools, skills, providers |

### Frontend & Security (Pass 2 — Complete)
| # | Document | Status | Summary |
|---|----------|--------|---------|
| 04 | [Web UI](04-web-ui.md) | Complete | Lit/Vite frontend, state management, chat, components |
| 05 | [Native Apps](05-native-apps.md) | Complete | iOS/macOS Swift, Android Kotlin, shared kit, duplication |
| 06 | [Security Model](06-security-model.md) | Complete | Trust boundaries, auth, sandbox, allowlists, credentials |

### Code Quality & Testing (Pass 3 — Pending)
| # | Document | Status | Summary |
|---|----------|--------|---------|
| 07 | [Code Quality](07-code-quality.md) | Pending | TS discipline, deps, file sizes, patterns |
| 08 | [Testing Infrastructure](08-testing-infrastructure.md) | Pending | Vitest, coverage, CI/CD, Docker testing |

### Features & UX (Pass 4 — Pending)
| # | Document | Status | Summary |
|---|----------|--------|---------|
| 09 | [Feature Inventory](09-feature-inventory.md) | Pending | Complete feature map across all surfaces |
| 10 | [UX Analysis](10-ux-analysis.md) | Pending | Onboarding, CLI, config complexity |

### Synthesis (Pass 5 — Pending)
| # | Document | Status | Summary |
|---|----------|--------|---------|
| 11 | [Strengths & Weaknesses](11-strengths-weaknesses.md) | Pending | SWOT with evidence |
| 12 | [Decision Matrix](12-decision-matrix.md) | Pending | Scored comparison for rebuild |
| 13 | [Rebuild Blueprint](13-rebuild-blueprint.md) | Pending | Clean-room architecture spec |

### Supporting
| Document | Purpose |
|----------|---------|
| [Conventions](CONVENTIONS.md) | Rating scales, cross-reference protocol, terminology |
| [Glossary](glossary.md) | Term definitions |

## Dependency Graph

```
01-gateway-core ──┐
02-channels-plugins ──┤──> 11-strengths-weaknesses ──> 12-decision-matrix
03-agent-runtime ──┤                                        │
04-web-ui ──┤                                               v
05-native-apps ──┤                                   13-rebuild-blueprint
06-security-model ──┤
07-code-quality ──┤
08-testing-infrastructure ──┤
09-feature-inventory ──┤
10-ux-analysis ──┘
```
