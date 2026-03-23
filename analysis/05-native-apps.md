# Native Apps Analysis

> **Status**: Complete
> **Pass**: 2 | **Agent**: native-apps-explorer
> **Depends On**: [-> 01-gateway-core](01-gateway-core.md)
> **Depended On By**: [-> 11-strengths-weaknesses](11-strengths-weaknesses.md), [-> 13-rebuild-blueprint](13-rebuild-blueprint.md)

## Executive Summary

OpenClaw has companion apps on macOS (Swift menu bar), iOS (Swift), and Android (Kotlin), sharing a Swift library (OpenClawKit) across Apple platforms. The shared kit handles protocol models (auto-generated from TS schemas), gateway communication, and chat UI. However, significant code duplication exists: 30-50% across voice features, command handlers, and chat transport. The Android app has a 40KB+ monolithic `NodeRuntime.kt`. Protocol codegen only covers Swift models — Kotlin reimplements everything manually.

## Scope

- **Source paths**: `apps/macos/`, `apps/ios/`, `apps/android/`, `apps/shared/`
- **Swift files**: ~605 (macOS + iOS + shared)
- **Kotlin files**: ~115 (Android)
- **Platform support**: iOS 18+, macOS 15+, Android (Compose)

## Architecture Overview

### Shared Kit (OpenClawKit)
```
OpenClawKit/
  Sources/
    OpenClawProtocol/   # Auto-generated models (GatewayModels.swift)
    OpenClawKit/        # Gateway client, sessions, utilities
    OpenClawChatUI/     # Shared chat components
```

- Protocol version 3, 16 command modules (Camera, Location, Chat, Canvas, Talk, etc.)
- `GatewayChannelActor` — async actor for WebSocket state, reconnection, auth
- TLS pinning, device identity signing, keep-alive at 15s, connect timeout 12s

### Platform-Specific

| Platform | Architecture | Key Pattern |
|----------|-------------|-------------|
| **macOS** | `AppState.swift` (@Observable) + `LaunchdManager` | Menu bar + gateway process management |
| **iOS** | `NodeAppModel` + functional extensions | Central state with native capability services |
| **Android** | `NodeRuntime.kt` (40KB+ monolith) + `InvokeDispatcher` | Central runtime + modular command handlers |

## Detailed Findings

### Shared Kit — Rating: 4/5 (Strong)

**Strengths:**
- Protocol models 100% reused via codegen (`scripts/protocol-gen-swift.ts`)
- Command payloads 95% reused across Apple platforms
- Chat UI shared between macOS and iOS
- Gateway connection logic shared via `GatewayChannelActor`

**Weaknesses:**
- Only covers Swift — no Kotlin codegen
- Chat UI not usable on Android (different framework)

### macOS App — Rating: 4/5 (Strong)

**Strengths:**
- Clean menu bar integration with icon animations
- Voice Wake with AVAudioEngine + Speech Recognition
- Gateway process management via LaunchdManager
- Canvas hosting (HTML canvas with A2UI protocol)
- 40+ test files

**Weaknesses:**
- Voice Wake has many tunable parameters (2s silence, 120s hard stop, RMS thresholds)
- Gateway management tightly coupled to launchd

### iOS App — Rating: 3/5 (Adequate)

**Strengths:**
- Rich native integrations (camera, location, contacts, motion, calendar, reminders)
- Push notifications with silent refresh
- QR code onboarding for gateway setup
- Live Activity support

**Weaknesses:**
- Many service classes (Location, Contacts, Calendar, Motion, Camera, etc.) with similar patterns
- Voice wake reimplements macOS logic (~30% duplication)

### Android App — Rating: 2/5 (Weak)

**Strengths:**
- Jetpack Compose UI (modern)
- Comprehensive handler coverage (Camera, Location, Contacts, Calendar, SMS, Photos, etc.)
- Coroutine-based gateway session

**Weaknesses:**
- `NodeRuntime.kt` is a 40KB+ God Object initializing all handlers
- Gateway protocol manually reimplemented (no codegen)
- Command handlers share 50% logic with Swift versions but are manually translated
- `InvokeDispatcher` is a large switch dispatch (not type-safe)

### Voice Features — Rating: 3/5 (Adequate)

**Cross-platform voice wake:**
- macOS: AVAudioEngine + Speech Recognition + Swabble kit
- iOS: Speech framework with permissions gating
- Android: SpeechRecognizer with fallback timeouts

**Duplication:** ~30% voice processing logic duplicated across 3 platforms

### Protocol Duplication — Rating: 2/5 (Weak)

| Area | Duplication | Notes |
|------|-------------|-------|
| Gateway connection | ~15-20% | WebSocket lifecycle, auth, reconnection |
| Voice processing | ~30% | Platform-specific APIs dominate |
| Command handlers | ~50% | Business logic duplicated |
| Chat transport | ~40% | Same request/response pattern |
| Protocol models | 0% (Swift) / 100% (Kotlin) | Codegen only for Swift |

## Cross-Component Dependencies

| Depends On | Nature | Strength |
|-----------|--------|----------|
| [-> 01-gateway-core](01-gateway-core.md#gateway-server) | All apps connect via WebSocket | Hard dependency |
| [-> 06-security-model](06-security-model.md#device-pairing) | Device pairing + auth | Hard dependency |

## Quality Metrics

| Metric | Value | Assessment |
|--------|-------|-----------|
| Test coverage | 40+ macOS, 5+ iOS, 20+ Android | Adequate (macOS best) |
| Type safety | Strong (Swift) / Adequate (Kotlin) | Good overall |
| Code sharing | ~70% Apple, ~0% Android | Poor cross-platform |
| Documentation | Sparse | Poor |

## Rebuild Implications

### Keep
- Shared Swift library pattern (OpenClawKit)
- Protocol codegen from TypeScript schemas
- Native capability integration (camera, location, etc.)
- Voice wake architecture (per-platform SDK usage)

### Redesign (Priority: M)
- **Extend codegen to Kotlin**: Generate Kotlin data classes from same Zod schemas
- **Decompose Android runtime**: Break 40KB `NodeRuntime.kt` into modules
- **Reduce voice duplication**: Extract shared voice processing logic into per-platform thin wrappers
- **Unify command handler business logic**: Define handler specs in shared schema, generate platform stubs

### Key Risks
- Codegen for Kotlin requires building a new generator
- Voice APIs are fundamentally platform-specific — full unification is impossible
- Native apps require platform expertise (Swift + Kotlin developers)
