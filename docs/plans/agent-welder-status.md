# Welder Integration Status — Container Package

Date: 2026-03-31
Branch: feature/nexus-improvements

## Summary

Implemented and wired the `@nexus/container` package into the Nexus gateway and CLI.
All stubs have been replaced with real logic. Typecheck passes; 46 new tests added and passing.

## Files Created

### packages/container/src/

- `cache.ts` — `DiskBlobCache` (filesystem-backed, stores at `~/.nexus/cache/blobs/sha256/<hash>`) and `MemoryBlobCache` (in-memory, for tests). Both satisfy the `BlobCache` interface.
- `oci-client.ts` (replaced stub) — Full OCI Distribution Spec v2 client:
  - `parseImageRef()` — parses `[registry/]repo[:tag|@digest]` to `ParsedImageRef`
  - `OciClient` — `resolveAuth()`, bearer token challenge flow, manifest pull, blob pull with sha256 digest verification, blob push, manifest push, tag listing with pagination, in-memory token cache
  - Error classes: `OciAuthError`, `OciManifestNotFoundError`, `OciDigestMismatchError`, `OciBlobNotFoundError`, `InvalidImageRefError`
- `runtime.ts` (replaced stub) — `WasmContainer` (Extism plugin wrapper) and `ContainerRuntime`:
  - `WasmContainer.start()` — loads Extism plugin with WASI, allowedPaths, allowedHosts, memory limits, pluginConfig
  - `WasmContainer.call()` — with configurable per-call timeout via `Promise.race`
  - `WasmContainer.stop()` — idempotent plugin close
  - `WasmContainer.restart()` — stop + start
  - `WasmContainer.inspect()` — returns exports filtered to function kind
  - `WasmContainer.logs()` — bounded circular log buffer, most recent first
  - `ContainerRuntime.create()` — pulls manifest + wasm blob via OciClient, creates WasmContainer
  - Error classes: `ContainerNotFoundError`, `ContainerNotRunningError`, `ContainerStartError`, `ContainerCallTimeoutError`, `ContainerTrapError`
- `lifecycle.ts` (replaced stub) — `LifecycleManager`:
  - Health check scheduling via `setInterval`, start-period grace window via `setTimeout`
  - Failure detection with consecutive failure counting
  - Restart policies: never / always / on-failure with exponential backoff (1s, 2s, 4s ... cap 60s)
  - Event emission on `@nexus/core` event bus for all state transitions
  - `shutdown()` via `Promise.allSettled`
- `index.ts` — Updated barrel to export all new concrete classes and error types

### packages/container/src/__tests__/

- `oci-client.test.ts` — 15 tests: parseImageRef, auth resolution, manifest pull, blob pull with cache hit/miss, digest verification, MemoryBlobCache CRUD
- `runtime.test.ts` — 14 tests: WasmContainer state machine, call/stop/restart, inspect export filtering, log buffer bounds, volume path mapping
- `lifecycle.test.ts` — 17 tests: start/stop/call, listContainerIds, event emission, health check scheduling, getManagedEntry

### packages/gateway/src/handlers/

- `container.ts` — 6 RPC handlers: `handleContainerRun`, `handleContainerStop`, `handleContainerList`, `handleContainerInspect`, `handleContainerLogs`, `handleContainerRemove`

### packages/gateway/src/__tests__/

- `container.test.ts` — 8 tests for RPC handlers with mocked `@nexus/container`

### packages/cli/src/commands/

- `container.ts` — 6 subcommands: `run`, `stop`, `list`, `inspect`, `logs`, `remove`

## Files Modified

- `packages/core/src/events.ts` — Added 5 container event types to `NexusEvents`
- `packages/gateway/src/server.ts` — Added container handler imports and 6 dispatch entries
- `packages/gateway/package.json` — Added `@nexus/container: "*"` dependency
- `packages/gateway/tsconfig.json` — Added `../container` project reference
- `packages/cli/src/index.ts` — Registered `containerCommand`
- `packages/cli/package.json` — Added `@nexus/container: "*"` dependency
- `packages/cli/tsconfig.json` — Added `../container` project reference
- `packages/container/package.json` — Added `uuid` dependency

## Verification

- `npm run typecheck` — passes (0 errors)
- `npm test` — 1526 tests passing, 2 pre-existing failures in `runtime-prompt-guard.test.ts` (unrelated to this integration)
- New tests added: 46 (from 1480 to 1526 passing)
