# Security Model Analysis

> **Status**: Complete
> **Pass**: 2 | **Agent**: security-reviewer
> **Depends On**: [-> 01-gateway-core](01-gateway-core.md), [-> 02-channels-plugins](02-channels-plugins.md)
> **Depended On By**: [-> 11-strengths-weaknesses](11-strengths-weaknesses.md), [-> 13-rebuild-blueprint](13-rebuild-blueprint.md)

## Executive Summary

OpenClaw's security model is intentionally designed for a single-operator trust model — one user per gateway, not multi-tenant. The auth system and sandbox are strong (timing-safe comparison, rate limiting, path safety with multi-pass validation). However, several areas are weak: credentials are stored unencrypted at rest, prompt injection detection is advisory-only, rate limiting is in-memory (lost on restart), and there's no persistent audit trail for exec approvals. The security posture is "defense in depth" rather than "policy enforced."

## Scope

- **Source paths**: `src/security/`, `src/pairing/`, `src/gateway/auth*.ts`, `src/agents/sandbox/`, `src/secrets/`, `SECURITY.md`
- **File count**: 28 security files, 15+ auth files, 10+ sandbox files
- **Security policy**: `SECURITY.md` (158+ lines, well-documented)

## Architecture Overview

### Trust Model
- **Single-operator**: One user per gateway instance
- **Authenticated callers = trusted operators** for that gateway
- **Session IDs are routing, not authorization** — no per-user boundaries
- **Explicit out-of-scope**: prompt injection without boundary bypass, operator-intended features

### Auth Flow
```
Client → [Token | Password | DevicePairing | Tailscale | TrustedProxy] → AuthRateLimiter → Gateway
```

### Security Layers
1. **Network**: TLS, loopback binding, Tailscale
2. **Auth**: Bearer token, password, device pairing (V2/V3), rate limiting
3. **Channel**: DM pairing with allowlists
4. **Execution**: Exec approval system, tool policy
5. **Sandbox**: Path safety, Docker/SSH isolation
6. **Content**: External content wrapping, prompt injection detection

## Detailed Findings

### Trust Model — Rating: 4/5 (Strong)

**Strengths:**
- Clear, documented trust boundaries
- Explicit about what is NOT a security bug (reduces false reports)
- Pragmatic: "strong defaults without killing capability"

**Weaknesses:**
- No path to multi-tenant if needed
- Relies on operator discipline for gateway isolation

### Auth System — Rating: 4/5 (Strong)

**Strengths:**
- 5 auth modes (token, password, device pairing, Tailscale, trusted proxy)
- Timing-safe secret comparison via SHA256 hashing (`secret-equal.ts`)
- Rate limiting: 10 attempts, 60s window, 5m lockout
- Device auth V3 with signed payloads (nonce, scope, role, platform)
- Loopback exemption for localhost

**Weaknesses:**
- Rate limiter in-memory only — lost on restart, no distributed support
- Password stored in config with no rotation mechanism
- Device auth payloads pipe-delimited (fragile format, not JSON)
- Loopback exemption could be abused via compromised proxy

**Key files:** `src/gateway/auth.ts`, `src/gateway/auth-rate-limit.ts`, `src/gateway/device-auth.ts`

### DM Pairing — Rating: 3/5 (Adequate)

**Strengths:**
- 8-char codes from restricted alphabet (34^8 ≈ 1.7 trillion combinations)
- 1-hour TTL, max 3 pending requests
- File-locked atomic JSON operations
- Human-verified (codes not transmitted over protocol)
- Allowlist supports wildcards and prefix matching

**Weaknesses:**
- No rate limiting on pairing attempts themselves
- Allowlist enforcement is per-channel, not centralized
- 25.7 bits of entropy (adequate but not generous)

**Key files:** `src/pairing/pairing-store.ts`, `src/pairing/pairing-challenge.ts`, `src/channels/allowlist-match.ts`

### Sandbox — Rating: 4/5 (Strong)

**Strengths:**
- Multi-pass path traversal protection (boundary check + canonical + writable)
- Symlink resolution with loop detection
- Multi-pass URL decoding with 32-pass limit (prevents DoS)
- Fail-closed on malformed encoding
- Docker and SSH backends with image pinning
- Mount-based access control with read/write flags

**Weaknesses:**
- Pre-existing symlink chains can bypass checks (documented, accepted risk)
- Same-path file replacement not mitigated (documented, accepted risk)

**Key files:** `src/agents/sandbox/fs-bridge-path-safety.ts`, `src/gateway/security-path.ts`

### Exec Approval — Rating: 3/5 (Adequate)

**Strengths:**
- UUID-based approval IDs
- Timeout-based expiration (15s grace period)
- One-time consumption for "allow-once"
- Caller metadata tracking (connId, deviceId, clientId)

**Weaknesses:**
- Grace period allows limited replay window
- No cross-process synchronization
- **No persistent audit trail** — approvals are fire-and-forget

**Key files:** `src/gateway/exec-approval-manager.ts`

### Credential Storage — Rating: 2/5 (Weak)

**Strengths:**
- Atomic writes with 0o600 permissions for secrets files
- Environment variable support for sensitive values
- Secret parsing handles quoted values

**Weaknesses:**
- **Config file world-readable by default** (no permission checks)
- **No encryption at rest** for YAML config
- Secrets cannot be rotated without restarting
- Bootstrap secrets must be plaintext in config

**Key files:** `src/secrets/shared.ts`

### Prompt Injection Defense — Rating: 2/5 (Weak)

**Strengths:**
- External content wrapping with unique random boundaries
- Unicode homoglyph folding to detect spoofed markers
- 12+ suspicious prompt injection patterns detected

**Weaknesses:**
- **Detection is advisory only** — logs but doesn't enforce/block
- No enforcement mechanism at runtime
- Warnings don't prevent processing of suspicious content

**Key files:** `src/security/external-content.ts`

### Security Audit Tooling — Rating: 3/5 (Adequate)

- 28 security files covering audit, channel-specific checks, tool policy
- `dangerous-config-flags.ts` and `dangerous-tools.ts` flag risky configurations
- `skill-scanner.ts` scans skill content for issues
- `safe-regex.ts` prevents ReDoS
- `windows-acl.ts` handles Windows-specific permissions

## Cross-Component Dependencies

| Depends On | Nature | Strength |
|-----------|--------|----------|
| [-> 01-gateway-core](01-gateway-core.md#config) | Config stores credentials | Hard dependency |
| [-> 02-channels-plugins](02-channels-plugins.md#channel-security) | Per-channel allowlist enforcement | Soft dependency |
| [-> 03-agent-runtime](03-agent-runtime.md#tools) | Tool gating via exec approvals | Hard dependency |

## Quality Metrics

| Metric | Value | Assessment |
|--------|-------|-----------|
| Test coverage | Extensive (many .test.ts files) | Good |
| Type safety | Strict | Good |
| Error handling | Fail-closed patterns | Strong |
| Documentation | SECURITY.md comprehensive | Excellent |

## Rebuild Implications

### Keep
- Single-operator trust model (simple, well-reasoned)
- Timing-safe secret comparison
- Multi-pass path traversal protection
- DM pairing concept with allowlists
- Sandbox with Docker/SSH backends

### Redesign (Priority: H)
- **Encrypted credential storage**: AES-256-GCM with keychain integration, not plaintext
- **Centralized allowlist enforcement**: Gateway-level, not per-channel
- **Persistent audit log**: SQLite table for all exec approvals, config changes, auth events
- **Persistent rate limiting**: SQLite-backed, survives restart
- **Enforced prompt injection detection**: Block suspicious content, not just log
- **Structured auth payloads**: JSON instead of pipe-delimited device auth

### Key Risks
- Encrypted credentials add key management complexity
- Enforced prompt injection may cause false positives — needs escape hatch
- Centralized allowlist must still allow per-channel overrides
