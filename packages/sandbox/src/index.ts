export {
  NetworkCapabilitySchema,
  FilesystemCapabilitySchema,
  MemoryCapabilitySchema,
  ToolCapabilitySchema,
  AgentCapabilitiesSchema,
  CAPABILITY_PROFILES,
  isToolAllowed,
  isHostAllowed,
} from "./capabilities.js";
export type {
  NetworkCapability,
  FilesystemCapability,
  MemoryCapability,
  ToolCapability,
  AgentCapabilities,
} from "./capabilities.js";

export type { HostFunction, SandboxInstance, SandboxRuntimeConfig, SandboxRuntime } from "./runtime.js";
export { InProcessSandbox, InProcessRuntime, SandboxPool } from "./runtime.js";
export type { SandboxPoolOptions } from "./runtime.js";

export { createHostFunctions } from "./host-functions.js";
export type { HostFunctionOptions } from "./host-functions.js";

export { SandboxMonitor } from "./monitor.js";
export type { SandboxMetrics, SandboxMonitorOptions } from "./monitor.js";

export { createGuestHandler } from "./guest/template.js";
export type {
  GuestExports,
  GuestHostImports,
  GuestMessage,
  GuestHandleMessageInput,
  GuestToolCall,
  GuestHandleMessageOutput,
} from "./guest/template.js";
