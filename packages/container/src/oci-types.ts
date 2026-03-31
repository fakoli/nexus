/**
 * OCI Image Spec artifact types for the @nexus/container package.
 *
 * These types correspond directly to the JSON wire format defined by the
 * OCI Image Spec (https://github.com/opencontainers/image-spec). Field names
 * are camelCase mappings of the spec's JSON keys so that `JSON.parse()` output
 * is assignable to these types without a translation layer.
 *
 * Consumers of these types: OciClient (parsing registry responses), and any
 * code that needs to inspect manifest contents (e.g., to find the Wasm layer).
 *
 * The ParsedImageRef type is also here because it is tightly coupled to OCI
 * reference parsing and is used as the primary input to OciClient methods.
 */

import { z } from "zod";

// ── OCI descriptor ────────────────────────────────────────────────────────────

/**
 * A single content-addressable artifact descriptor.
 *
 * Used in OCI manifests (to reference config and layer blobs) and in image
 * indexes (to reference platform-specific manifests). The `digest` field is
 * always "algorithm:hex" (e.g., "sha256:abc123..."). Every blob download
 * verifies computed digest against this value for integrity.
 */
export const OciDescriptorSchema = z.object({
  mediaType: z.string(),
  digest: z.string().regex(
    /^[a-z0-9]+:[a-f0-9]+$/,
    "digest must be in algorithm:hex format, e.g. sha256:abc123",
  ),
  size: z.number().int().min(0),
  annotations: z.record(z.string(), z.string()).optional(),
  /**
   * Platform metadata, present only in image index entries.
   * OciClient uses this to select the correct manifest for the host platform
   * when pulling a multi-arch image.
   */
  platform: z
    .object({
      architecture: z.string(),
      os: z.string(),
      variant: z.string().optional(),
    })
    .optional(),
});

export type OciDescriptor = z.infer<typeof OciDescriptorSchema>;

// ── OCI manifest ──────────────────────────────────────────────────────────────

/**
 * OCI image manifest (single-arch).
 *
 * Received from GET /v2/<name>/manifests/<ref> when Content-Type is
 * application/vnd.oci.image.manifest.v1+json.
 *
 * For Wasm images, layers[0] is typically the raw .wasm blob (media type
 * application/vnd.wasm.content.layer.v1+wasm or a gzip-compressed variant).
 * The OciClient extracts the Wasm bytes from the first matching layer.
 */
export const OciManifestSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.string(),
  config: OciDescriptorSchema,
  layers: z.array(OciDescriptorSchema).min(1),
  annotations: z.record(z.string(), z.string()).optional(),
});

export type OciManifest = z.infer<typeof OciManifestSchema>;

// ── OCI image index ───────────────────────────────────────────────────────────

/**
 * OCI image index (multi-arch manifest list).
 *
 * Received when Content-Type is application/vnd.oci.image.index.v1+json.
 * Each entry in `manifests` references a platform-specific OciManifest.
 *
 * OciClient resolves the index transparently — callers always receive an
 * OciManifest, never an OciImageIndex. This type is exported for implementors
 * of the OciClient interface who need to handle the intermediate index response.
 */
export const OciImageIndexSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.string(),
  manifests: z.array(OciDescriptorSchema).min(1),
  annotations: z.record(z.string(), z.string()).optional(),
});

export type OciImageIndex = z.infer<typeof OciImageIndexSchema>;

// ── OCI image config ──────────────────────────────────────────────────────────

/**
 * Decoded OCI image config blob.
 *
 * The content of the blob referenced by OciManifest.config. Carries build-time
 * metadata: entrypoint, environment, labels. For Wasm-native images (wasm-pack,
 * extism build), many fields may be absent — all fields are optional.
 *
 * The nested `config` object uses PascalCase field names (Entrypoint, Cmd, Env)
 * to match the OCI Image Spec JSON schema verbatim.
 */
export const OciImageConfigSchema = z.object({
  architecture: z.string().optional(),
  os: z.string().optional(),
  config: z
    .object({
      Entrypoint: z.array(z.string()).optional(),
      Cmd: z.array(z.string()).optional(),
      /** Env vars in KEY=VALUE format as set by the image builder. */
      Env: z.array(z.string()).optional(),
      Labels: z.record(z.string(), z.string()).optional(),
      WorkingDir: z.string().optional(),
    })
    .optional(),
  rootfs: z
    .object({
      type: z.string(),
      /** DiffIDs: uncompressed layer digests in layer order. */
      diff_ids: z.array(z.string()),
    })
    .optional(),
  history: z
    .array(
      z.object({
        created: z.string().optional(),
        created_by: z.string().optional(),
        comment: z.string().optional(),
        empty_layer: z.boolean().optional(),
      }),
    )
    .optional(),
});

export type OciImageConfig = z.infer<typeof OciImageConfigSchema>;

// ── Parsed image reference ────────────────────────────────────────────────────

/**
 * Parsed components of an OCI image reference string.
 *
 * Parsing rules (following containerd/reference):
 * - No hostname → registry = "registry-1.docker.io"
 * - Bare image name (no slash) → repository = "library/<name>"
 * - No tag and no digest → reference = "latest"
 * - Digest (@sha256:...) takes precedence over tag when both are present
 *
 * `original` preserves the input string for error messages. Reconstructing the
 * original from parsed components is lossy ("ubuntu" normalizes to
 * "registry-1.docker.io/library/ubuntu:latest").
 */
export const ParsedImageRefSchema = z.object({
  /** Registry hostname. Example: "ghcr.io", "registry-1.docker.io" */
  registry: z.string(),
  /** Repository path. Example: "myorg/my-plugin", "library/alpine" */
  repository: z.string(),
  /**
   * Tag or digest for the manifest reference.
   * Examples: "latest", "1.2.3", "sha256:abc..."
   */
  reference: z.string(),
  /** Verbatim input string before parsing. */
  original: z.string(),
});

export type ParsedImageRef = z.infer<typeof ParsedImageRefSchema>;

// ── OCI media type constants ──────────────────────────────────────────────────

/**
 * OCI and Docker media type string constants.
 *
 * Used as Accept header values, Content-Type values, and for discriminating
 * manifest responses. A const object rather than an enum: enum values are
 * runtime objects that require import; const object values are plain strings,
 * usable in switch cases without any import.
 */
export const MEDIA_TYPES = {
  OCI_MANIFEST: "application/vnd.oci.image.manifest.v1+json",
  OCI_INDEX: "application/vnd.oci.image.index.v1+json",
  OCI_CONFIG: "application/vnd.oci.image.config.v1+json",
  OCI_LAYER_TAR: "application/vnd.oci.image.layer.v1.tar",
  OCI_LAYER_GZIP: "application/vnd.oci.image.layer.v1.tar+gzip",
  OCI_LAYER_ZSTD: "application/vnd.oci.image.layer.v1.tar+zstd",
  OCI_EMPTY: "application/vnd.oci.empty.v1+json",
  DOCKER_MANIFEST_V2: "application/vnd.docker.distribution.manifest.v2+json",
  DOCKER_MANIFEST_LIST: "application/vnd.docker.distribution.manifest.list.v2+json",
  /** Wasm content layer — used by extism-pack and wasm-oci tooling. */
  WASM: "application/vnd.wasm.content.layer.v1+wasm",
} as const;

export type MediaType = (typeof MEDIA_TYPES)[keyof typeof MEDIA_TYPES];
