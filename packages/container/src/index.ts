// ── OCI client ────────────────────────────────────────────────────────────────
export {
  OciClient,
  parseImageRef,
  TOKEN_REFRESH_THRESHOLD_MS,
  OciAuthError,
  OciManifestNotFoundError,
  OciDigestMismatchError,
  OciBlobNotFoundError,
  InvalidImageRefError,
  OciSsrfBlockedError,
  DiskBlobCache,
} from "./oci-client.js";
export type {
  OciClientOptions,
  BlobCache,
  TokenCacheEntry,
} from "./oci-client.js";

// ── OCI auth helpers ──────────────────────────────────────────────────────────
export { isBlockedHostname, resolveAuth, resolveCredentialForRegistry } from "./oci-auth.js";

// ── Cache ─────────────────────────────────────────────────────────────────────
export { MemoryBlobCache } from "./cache.js";

// ── Container runtime ─────────────────────────────────────────────────────────
export {
  WasmContainer,
  ContainerRuntime,
  ContainerNotFoundError,
  ContainerNotRunningError,
  ContainerStartError,
  ContainerCallTimeoutError,
  ContainerTrapError,
} from "./runtime.js";
export type {
  ContainerRuntimeOptions,
  ContainerInspect,
  CallOptions,
  LogEntry,
} from "./runtime.js";

// ── Lifecycle management ──────────────────────────────────────────────────────
export { LifecycleManager } from "./lifecycle.js";
export type {
  LifecycleManagerOptions,
  ManagedContainerEntry,
  HealthCheckState,
  StartResult,
} from "./lifecycle.js";

// ── Container config and state types ─────────────────────────────────────────
export {
  RestartPolicySchema,
  VolumeMountSchema,
  HealthCheckConfigSchema,
  RegistryAuthSchema,
  ContainerConfigSchema,
  ContainerStatusSchema,
  ContainerStateSchema,
  ContainerStatsSchema,
} from "./types.js";
export type {
  RestartPolicy,
  VolumeMount,
  HealthCheckConfig,
  RegistryAuth,
  ContainerConfig,
  ContainerStatus,
  ContainerState,
  ContainerStats,
} from "./types.js";

// ── OCI artifact types ────────────────────────────────────────────────────────
export {
  OciDescriptorSchema,
  OciManifestSchema,
  OciImageIndexSchema,
  OciImageConfigSchema,
  ParsedImageRefSchema,
  MEDIA_TYPES,
} from "./oci-types.js";
export type {
  OciDescriptor,
  OciManifest,
  OciImageIndex,
  OciImageConfig,
  ParsedImageRef,
  MediaType,
} from "./oci-types.js";
