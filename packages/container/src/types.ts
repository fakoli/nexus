/**
 * Container configuration and state types for the @nexus/container package.
 *
 * OCI artifact types (OciDescriptor, OciManifest, etc.) live in oci-types.ts.
 * This file covers: container lifecycle config, auth, volumes, health checks,
 * restart policy, container status/state, and runtime stats.
 *
 * Design principles:
 *
 * 1. Every config type is a Zod schema first; the TypeScript type is inferred
 *    from the schema. Runtime validation and static types are always in sync.
 *
 * 2. Volume mounts carry { hostPath, guestPath } to match Extism's `allowedPaths`
 *    convention. The runtime builds the Extism options object from these; callers
 *    do not need to know which direction the mapping runs.
 *
 * 3. Status values are a string union rather than an enum. Enum values are
 *    runtime objects that require import; string literals are just strings and
 *    compare without importing anything.
 *
 * 4. All timestamps are ISO 8601 strings, not Date objects, so state snapshots
 *    can be round-tripped through JSON without transformation.
 */

import { z } from "zod";

// ── Restart policy ────────────────────────────────────────────────────────────

/**
 * Controls what the LifecycleManager does when a container exits unexpectedly.
 *
 * "never"      — stop and leave as-is (default; safe for task containers)
 * "always"     — restart unconditionally on any exit, including clean exits
 * "on-failure" — restart only when exit code is non-zero, up to maxRetries
 *
 * A discriminated union prevents "always" from carrying a meaningless
 * maxRetries field and makes exhaustive switch handling safe.
 */
export const RestartPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("never") }),
  z.object({ mode: z.literal("always") }),
  z.object({
    mode: z.literal("on-failure"),
    /** Maximum automatic restart attempts before the container is left in "failed" state. */
    maxRetries: z.number().int().min(1).default(3),
  }),
]);

export type RestartPolicy = z.infer<typeof RestartPolicySchema>;

// ── Volume mount ─────────────────────────────────────────────────────────────

/**
 * Maps a host directory into the Wasm guest's WASI filesystem.
 *
 * `readOnly` is advisory metadata: WASI Preview 1 has no native read-only
 * preopen flag. The runtime enforces this via OS-level permissions or
 * post-call diffing (reference doc §2.4). The field exists here so that
 * intent is visible at the call site even if enforcement is external.
 *
 * `guestPath` must be absolute; WASI preopens are always absolute paths.
 */
export const VolumeMountSchema = z.object({
  /** Absolute path on the host filesystem to expose to the Wasm guest. */
  hostPath: z.string().min(1),
  /** Absolute path the Wasm guest uses to access this directory. */
  guestPath: z.string().min(1).startsWith("/"),
  /**
   * Whether the guest should be restricted to read-only access.
   * Enforcement is the runtime implementor's responsibility.
   */
  readOnly: z.boolean().default(true),
});

export type VolumeMount = z.infer<typeof VolumeMountSchema>;

// ── Health check config ───────────────────────────────────────────────────────

/**
 * Configures periodic liveness probing via a named Wasm export.
 *
 * The LifecycleManager calls `plugin.call(functionName, "")` on each interval.
 * A successful return (non-null, no thrown error) is a healthy result. A throw
 * or null after `retries` consecutive failures marks the container unhealthy
 * and triggers the restart policy.
 *
 * `startPeriodMs` is a grace window after container start during which probe
 * failures do not count toward the retry budget. Mirrors Docker's
 * `--health-start-period` for containers that need warm-up time.
 */
export const HealthCheckConfigSchema = z.object({
  /**
   * Name of the exported Wasm function invoked as the health probe.
   * Must accept no arguments (empty input string) and return any non-null
   * value to signal health.
   */
  functionName: z.string().min(1).default("health"),
  /** How often to run the probe, in milliseconds. */
  intervalMs: z.number().int().min(1000).default(30_000),
  /** Maximum duration a single probe call may take before it counts as failed. */
  timeoutMs: z.number().int().min(100).default(5_000),
  /** Number of consecutive probe failures before the container is marked unhealthy. */
  retries: z.number().int().min(1).default(3),
  /** Grace period after start during which probe failures are ignored, in milliseconds. */
  startPeriodMs: z.number().int().min(0).default(0),
});

export type HealthCheckConfig = z.infer<typeof HealthCheckConfigSchema>;

// ── Registry authentication ───────────────────────────────────────────────────

/**
 * Credentials for authenticating against a single OCI registry.
 *
 * Four mutually exclusive mechanisms as a discriminated union:
 *
 * - "token"             — pre-fetched Bearer token (already resolved; short-lived)
 * - "basic"             — username + password for the Bearer challenge flow
 * - "credential-helper" — delegates to a `docker-credential-<name>` binary
 * - "anonymous"         — no authentication (public registries)
 *
 * Resolution order in OciClient: token → basic → credential-helper → anonymous.
 * The client never stores passwords beyond the duration of the request.
 */
export const RegistryAuthSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("token"),
    token: z.string().min(1),
    /**
     * Unix epoch milliseconds after which this token is expired.
     * OciClient refreshes 30 s before this threshold to avoid mid-request failures.
     */
    expiresAt: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal("basic"),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  z.object({
    kind: z.literal("credential-helper"),
    /** Short name for `docker-credential-<name> get`. E.g. "osxkeychain", "gcr". */
    helperName: z.string().min(1),
  }),
  z.object({
    kind: z.literal("anonymous"),
  }),
]);

export type RegistryAuth = z.infer<typeof RegistryAuthSchema>;

// ── Container config ──────────────────────────────────────────────────────────

/**
 * Full specification for a long-running Wasm container.
 *
 * `image` is an OCI image reference string, parsed by `parseImageRef`.
 * Accepted formats: [registry/]repository[:tag|@digest]
 *
 * `memoryLimitPages` maps directly to Extism's `memory.maxPages` (1 page = 64 KiB).
 * The unit is explicit to avoid the MiB/pages confusion present in the sandbox
 * package. Default 256 pages = 16 MiB.
 *
 * `pluginConfig` is the static key-value store passed at Extism plugin creation
 * via `createPlugin(source, { config: pluginConfig })`. All values must be strings.
 */
export const ContainerConfigSchema = z.object({
  /** OCI image reference. Example: "ghcr.io/myorg/my-plugin:1.2.3" */
  image: z.string().min(1),
  /** Environment variables forwarded to the plugin's WASI environment. */
  env: z.record(z.string(), z.string()).default({}),
  /** Host-to-guest filesystem mounts, expressed as WASI preopens. */
  volumes: z.array(VolumeMountSchema).default([]),
  /**
   * Outbound HTTP hostnames the plugin may contact via Extism host HTTP.
   * Use ["*"] to allow all outbound connections.
   */
  allowedHosts: z.array(z.string()).default([]),
  /** Wasm linear memory limit in 64 KiB pages. 256 pages = 16 MiB. */
  memoryLimitPages: z.number().int().min(1).default(256),
  /** Per-call timeout in milliseconds applied to every plugin.call() invocation. */
  timeoutMs: z.number().int().min(100).default(30_000),
  /** What to do when the container exits or fails. */
  restartPolicy: RestartPolicySchema.default({ mode: "never" }),
  /** Liveness probe configuration. Omit to disable health checking. */
  healthCheck: HealthCheckConfigSchema.optional(),
  /** Registry credentials. Defaults to anonymous. */
  auth: RegistryAuthSchema.default({ kind: "anonymous" }),
  /**
   * Static key-value config passed to the Extism plugin at creation time.
   * All values must be strings; serialize numbers before passing.
   */
  pluginConfig: z.record(z.string(), z.string()).default({}),
  /** Human-readable label attached to logs and inspect output. */
  name: z.string().optional(),
});

export type ContainerConfig = z.infer<typeof ContainerConfigSchema>;

// ── Container status and state ────────────────────────────────────────────────

/**
 * Lifecycle status values for a WasmContainer instance.
 *
 * State machine:
 *
 *   created ──start()──▶ running ──stop()──▶ stopped
 *                           │                    ▲
 *                           └──(crash/timeout)──▶ failed ──restart()──┘
 *                           │
 *                           └──(health check fails)──▶ unhealthy ──restart()──┘
 *
 * "created" means the Extism plugin has been instantiated but start() has not
 * been called yet. This allows inspect() before any workload calls.
 */
export const ContainerStatusSchema = z.enum([
  "created",
  "running",
  "stopped",
  "failed",
  "unhealthy",
]);

export type ContainerStatus = z.infer<typeof ContainerStatusSchema>;

/**
 * Runtime state snapshot for a container instance.
 *
 * All timestamps are ISO 8601 strings (not Date objects) so that state values
 * survive JSON serialization in RPC responses and audit logs without transformation.
 */
export const ContainerStateSchema = z.object({
  status: ContainerStatusSchema,
  /** ISO 8601 timestamp of the most recent start() call. */
  startedAt: z.string().datetime().optional(),
  /** ISO 8601 timestamp of the most recent stop or crash. */
  stoppedAt: z.string().datetime().optional(),
  /**
   * Count of automatic restarts triggered by the restart policy.
   * Reset to zero on an explicit stop(). Incremented only by LifecycleManager
   * automatic restarts, not by caller-initiated restart() calls.
   */
  restartCount: z.number().int().min(0).default(0),
  /**
   * Exit code from the last Wasm trap or clean exit.
   * null means the container is running or was never started.
   * Non-zero values trigger "on-failure" restart policy.
   */
  exitCode: z.number().int().nullable().default(null),
  /** Last error message, populated when status is "failed" or "unhealthy". */
  error: z.string().optional(),
});

export type ContainerState = z.infer<typeof ContainerStateSchema>;

// ── Container stats ───────────────────────────────────────────────────────────

/**
 * Runtime metrics snapshot for a running container.
 *
 * `memoryUsageBytes` reflects the Wasm module's current linear memory
 * (pages * 65_536). This is Wasm module memory only, not process heap.
 * Wasm linear memory can only grow, never shrink; it resets on restart.
 *
 * `callCount` counts plugin.call() invocations since the last start(). Resets
 * to zero on every restart.
 */
export const ContainerStatsSchema = z.object({
  containerId: z.string(),
  memoryUsageBytes: z.number().int().min(0),
  callCount: z.number().int().min(0),
  /** Milliseconds elapsed since the container was last started. */
  uptimeMs: z.number().int().min(0),
  /** ISO 8601 timestamp of this snapshot. */
  sampledAt: z.string().datetime(),
});

export type ContainerStats = z.infer<typeof ContainerStatsSchema>;
