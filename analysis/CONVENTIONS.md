# Analysis Conventions

## Rating Scale (1-5)

| Score | Label | Meaning |
|-------|-------|---------|
| 5 | Excellent | Best-in-class; adopt as-is in rebuild |
| 4 | Strong | Minor improvements needed; mostly keep |
| 3 | Adequate | Functional but needs modernization |
| 2 | Weak | Significant redesign needed |
| 1 | Critical | Fundamentally broken; rebuild from scratch |

## Rebuild Priority

- **H (High)**: Must address in rebuild MVP
- **M (Medium)**: Address in first iteration post-MVP
- **L (Low)**: Can defer to later iterations

## Cross-Reference Format

```markdown
# Link to another analysis doc section:
[-> 03-agent-runtime: Tool Execution](03-agent-runtime.md#tool-execution)

# Shorthand in tables:
[-> 03#tools](03-agent-runtime.md#tools)

# Source code reference with analysis link:
`src/gateway/server.impl.ts` (see [-> 06#auth](06-security-model.md#auth-system))
```

## Document Template

Each analysis doc follows this structure:
1. **Executive Summary** — 3-5 sentences
2. **Scope** — Source paths, file count, LOC
3. **Architecture Overview** — Diagram, key abstractions, data flow
4. **Detailed Findings** — Per-subarea with rating, strengths, weaknesses, evidence
5. **Cross-Component Dependencies** — Table of dependencies
6. **Quality Metrics** — Coverage, type safety, error handling, docs
7. **Rebuild Implications** — What to keep, redesign, key risks

## Terminology

- **OpenClaw** — The product being analyzed (competitor)
- **Nexus** — Working name for the clean-room rebuild
- **Gateway** — WebSocket control plane server
- **Channel** — Messaging platform integration (Telegram, Discord, etc.)
- **Agent** — AI assistant runtime instance
- **Skill** — Bundled capability definition (SKILL.md + frontmatter)
- **Extension** — Plugin package in `extensions/` directory
- **Pi** — OpenClaw's embedded agent runtime (external dependency)
