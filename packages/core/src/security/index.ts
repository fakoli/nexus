export {
  scanForInjection,
  enforcePromptGuard,
} from "./prompt-guard.js";
export type { Detection, ScanResult } from "./prompt-guard.js";

export {
  wrapExternalContent,
  sanitizeMarkers,
  extractBoundaryMetadata,
} from "./content-boundary.js";
export type { BoundaryMetadata } from "./content-boundary.js";

export { validateUrl } from "./ssrf-guard.js";
export type { ValidationResult } from "./ssrf-guard.js";

export { checkToolPolicy, matchGlob } from "./tool-policy.js";
export type { ToolPolicy, PolicyResult } from "./tool-policy.js";

export { resolveSafePath, detectSymlinkEscape } from "./path-guard.js";

export { checkMountAccess, getDefaultMounts } from "./workspace-mount.js";
export type { WorkspaceConfig, MountEntry, AccessResult } from "./workspace-mount.js";
