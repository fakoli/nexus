# OCI Registry + Extism Wasm Runtime — Implementation Reference

Researched: 2026-03-31
OCI Distribution Spec: https://distribution.github.io/distribution/spec/api/
OCI Image Spec: https://github.com/opencontainers/image-spec/blob/main/manifest.md
Extism JS SDK: https://github.com/extism/js-sdk
Extism JS SDK API Docs: https://extism.github.io/js-sdk/
Node.js WASI API: https://nodejs.org/api/wasi.html

---

## Part 1 — OCI Registry HTTP API v2

### 1.1 Base URL and Version Check

Every OCI-conformant registry serves at `/v2/`. A `GET /v2/` request is the probe used to detect auth requirements.

```
GET https://<registry>/v2/
```

**Success (no auth):** `200 OK`, header `Docker-Distribution-API-Version: registry/2.0`
**Auth required:** `401 Unauthorized` + `WWW-Authenticate` challenge header
**Not supported:** `404 Not Found`

---

### 1.2 Authentication — Token Challenge Flow

This is a three-step flow shared by all registries (Docker Hub, ghcr.io, custom). The only difference between registries is the realm URL and service name embedded in the challenge.

#### Step 1 — Receive the 401 challenge

Any unauthenticated registry request returns:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/alpine:pull"
```

Parse the `WWW-Authenticate` header. Extract `realm`, `service`, and `scope` as the three required query parameters.

Known realm URLs by registry:

| Registry | Realm URL | Service |
|----------|-----------|---------|
| Docker Hub | `https://auth.docker.io/token` | `registry.docker.io` |
| ghcr.io | `https://ghcr.io/token` | `ghcr.io` |
| AWS ECR | `https://<account>.dkr.ecr.<region>.amazonaws.com` | (varies) |
| Self-hosted Distribution | Configured at startup | Configured at startup |

#### Step 2 — Fetch a bearer token

```
GET https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/alpine:pull
```

For authenticated requests, attach HTTP Basic Auth credentials:

```
Authorization: Basic base64(username:password)
```

**Response (200 OK):**

```json
{
  "token": "eyJ0eXAiOiJKV1QiLC...",
  "access_token": "eyJ0eXAiOiJKV1QiLC...",
  "expires_in": 3600,
  "issued_at": "2024-01-15T10:00:00Z",
  "refresh_token": "optional, only when offline_token=true was requested"
}
```

Use `token` (or `access_token` as a fallback; they are identical). `expires_in` is seconds; default minimum is 60 seconds.

#### Step 3 — Use the bearer token

Attach to all subsequent requests:

```
Authorization: Bearer eyJ0eXAiOiJKV1QiLC...
```

#### Scope format

```
repository:<name>:<actions>
```

- `<name>` is the repository path, e.g., `library/alpine` or `myorg/myimage`
- `<actions>` is a comma-separated list: `pull`, `push`, or `pull,push`
- For tag listing: `repository:<name>:pull` (pull scope is sufficient)

ghcr.io scope examples:

```
repository:myorg/myimage:pull
repository:myorg/myimage:pull,push
```

---

### 1.3 Reading `~/.docker/config.json` for Stored Credentials

Docker stores credentials in `~/.docker/config.json`. Three possible storage mechanisms exist:

#### Inline base64 (legacy, still common)

```json
{
  "auths": {
    "https://index.docker.io/v1/": {
      "auth": "dXNlcm5hbWU6cGFzc3dvcmQ="
    },
    "ghcr.io": {
      "auth": "dXNlcm5hbWU6Z2hwX3Rva2Vu"
    }
  }
}
```

`auth` is `base64(username:password)`. Decode with `Buffer.from(auth, 'base64').toString('utf8')`, then split on the first `:`.

#### Per-registry credential helper (`credHelpers`)

```json
{
  "credHelpers": {
    "gcr.io": "gcr",
    "us.gcr.io": "gcr",
    "123456789.dkr.ecr.us-east-1.amazonaws.com": "ecr-login"
  }
}
```

The helper program name is `docker-credential-<value>` (e.g., `docker-credential-gcr`). Invoke it via stdin/stdout:

```
echo "gcr.io" | docker-credential-gcr get
```

Returns JSON: `{ "Username": "<user>", "Secret": "<token>" }`

#### Default credential store (`credsStore`)

```json
{
  "credsStore": "osxkeychain"
}
```

Falls back to `docker-credential-osxkeychain get` for all registries not in `credHelpers`.

#### TypeScript helper to read Docker credentials

```typescript
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

interface DockerConfig {
  auths?: Record<string, { auth?: string }>;
  credHelpers?: Record<string, string>;
  credsStore?: string;
}

interface Credentials {
  username: string;
  password: string;
}

function readDockerCredentials(registry: string): Credentials | null {
  const configPath = join(homedir(), '.docker', 'config.json');
  let config: DockerConfig;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as DockerConfig;
  } catch {
    return null;
  }

  // Normalise registry key — Docker Hub stores as "https://index.docker.io/v1/"
  const keys = [registry, `https://${registry}`, `https://${registry}/v1/`];

  // 1. Check credHelpers first
  for (const key of keys) {
    const helper = config.credHelpers?.[key];
    if (helper) {
      return invokeCredHelper(helper, key);
    }
  }

  // 2. Check credsStore
  if (config.credsStore) {
    return invokeCredHelper(config.credsStore, registry);
  }

  // 3. Fall back to inline auth
  for (const key of keys) {
    const entry = config.auths?.[key];
    if (entry?.auth) {
      const decoded = Buffer.from(entry.auth, 'base64').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      return {
        username: decoded.slice(0, colonIdx),
        password: decoded.slice(colonIdx + 1),
      };
    }
  }

  return null;
}

function invokeCredHelper(helper: string, registry: string): Credentials | null {
  try {
    const result = execSync(`docker-credential-${helper} get`, {
      input: registry,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result) as { Username: string; Secret: string };
    return { username: parsed.Username, password: parsed.Secret };
  } catch {
    return null;
  }
}
```

---

### 1.4 Pull Manifest

```
GET https://<registry>/v2/<name>/manifests/<reference>
```

- `<name>`: repository path, e.g., `library/alpine` or `myorg/myimage`
- `<reference>`: tag (`latest`, `1.2.3`) or digest (`sha256:abc123...`)

**Required Accept headers** — send all of these to get the best manifest the registry can serve:

```
Accept: application/vnd.oci.image.index.v1+json
Accept: application/vnd.oci.image.manifest.v1+json
Accept: application/vnd.docker.distribution.manifest.v2+json
Accept: application/vnd.docker.distribution.manifest.list.v2+json
```

**Response headers:**

| Header | Value |
|--------|-------|
| `Content-Type` | One of the Accept media types above |
| `Docker-Content-Digest` | `sha256:<hex>` — the canonical digest of the manifest body |
| `Content-Length` | Manifest body size in bytes |

**OCI image manifest body (single-arch):**

```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "config": {
    "mediaType": "application/vnd.oci.image.config.v1+json",
    "digest": "sha256:...",
    "size": 7023
  },
  "layers": [
    {
      "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
      "digest": "sha256:...",
      "size": 32654
    }
  ],
  "annotations": {}
}
```

**OCI image index body (multi-arch):**

```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.index.v1+json",
  "manifests": [
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:...",
      "size": 1234,
      "platform": {
        "architecture": "amd64",
        "os": "linux"
      }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:...",
      "size": 1234,
      "platform": {
        "architecture": "arm64",
        "os": "linux"
      }
    }
  ]
}
```

When you receive an image index, select the platform-specific manifest by `platform.architecture` + `platform.os`, then fetch that manifest by its digest.

**TypeScript fetch example:**

```typescript
async function fetchManifest(
  registry: string,
  name: string,
  reference: string,
  token: string,
): Promise<{ manifest: unknown; digest: string; mediaType: string }> {
  const url = `https://${registry}/v2/${name}/manifests/${reference}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: [
        'application/vnd.oci.image.index.v1+json',
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.docker.distribution.manifest.v2+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
      ].join(', '),
    },
  });

  if (!response.ok) {
    throw new Error(`Manifest fetch failed: ${response.status} ${await response.text()}`);
  }

  const digest = response.headers.get('Docker-Content-Digest') ?? '';
  const mediaType = response.headers.get('Content-Type') ?? '';
  const manifest = await response.json() as unknown;
  return { manifest, digest, mediaType };
}
```

---

### 1.5 Pull Blob (Layer)

```
GET https://<registry>/v2/<name>/blobs/<digest>
```

- `<digest>`: `sha256:<hex>` — taken from a layer descriptor in the manifest

**Response:** binary stream, `Content-Type: application/octet-stream`

The registry may return `307 Temporary Redirect` to a CDN. `fetch()` follows redirects automatically.

**Response headers:**

| Header | Value |
|--------|-------|
| `Docker-Content-Digest` | `sha256:<hex>` — verify this matches the requested digest |
| `Content-Length` | Byte count |

**Check existence without downloading:**

```
HEAD https://<registry>/v2/<name>/blobs/<digest>
```

Returns `200` + `Content-Length` + `Docker-Content-Digest`, or `404` if missing.

**TypeScript fetch + verify example:**

```typescript
import { createHash } from 'node:crypto';

async function fetchBlob(
  registry: string,
  name: string,
  digest: string,
  token: string,
): Promise<Uint8Array> {
  const url = `https://${registry}/v2/${name}/blobs/${digest}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Blob fetch failed: ${response.status}`);
  }

  const data = new Uint8Array(await response.arrayBuffer());

  // Verify content-addressable integrity
  const [algorithm, expectedHex] = digest.split(':');
  const actualHex = createHash(algorithm ?? 'sha256').update(data).digest('hex');
  if (actualHex !== expectedHex) {
    throw new Error(`Digest mismatch: expected ${digest}, got ${algorithm}:${actualHex}`);
  }

  return data;
}
```

---

### 1.6 Content-Addressable Storage — How Digests Work

Every blob and manifest is identified by `algorithm:hex`, where:

- `algorithm` is `sha256` (required) or `sha512` (optional)
- `hex` is the lowercase hex encoding of the hash of the content bytes

For blobs: hash the raw bytes of the layer tarball.
For manifests: hash the raw bytes of the JSON body exactly as received (byte-for-byte, including whitespace).

**Verification pattern:**

```typescript
import { createHash } from 'node:crypto';

function verifyDigest(data: Uint8Array, expectedDigest: string): void {
  const [algorithm, expectedHex] = expectedDigest.split(':') as [string, string];
  const actualHex = createHash(algorithm).update(data).digest('hex');
  if (actualHex !== expectedHex) {
    throw new Error(
      `Content digest mismatch — expected ${expectedDigest}, computed ${algorithm}:${actualHex}`,
    );
  }
}

function computeDigest(data: Uint8Array, algorithm = 'sha256'): string {
  return `${algorithm}:${createHash(algorithm).update(data).digest('hex')}`;
}
```

---

### 1.7 Push Blob (Upload)

Pushing a blob requires a two-step upload. There is also a single-POST monolithic path but it is less widely supported.

#### Step 1 — Initiate upload

```
POST https://<registry>/v2/<name>/blobs/uploads/
```

**Response:** `202 Accepted`

```
Location: /v2/<name>/blobs/uploads/<uuid>
Docker-Upload-UUID: <uuid>
```

Use the `Location` header as the upload URL for subsequent requests. It may be an absolute URL.

#### Step 2 — Complete upload with full blob (monolithic)

```
PUT <location>?digest=sha256:<hex>
Content-Type: application/octet-stream
Content-Length: <bytes>

<blob data>
```

**Response:** `201 Created`

```
Location: /v2/<name>/blobs/sha256:<hex>
Docker-Content-Digest: sha256:<hex>
```

**TypeScript push example:**

```typescript
async function pushBlob(
  registry: string,
  name: string,
  data: Uint8Array,
  digest: string,
  token: string,
): Promise<void> {
  // Step 1: initiate
  const initiateResp = await fetch(
    `https://${registry}/v2/${name}/blobs/uploads/`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (initiateResp.status !== 202) {
    throw new Error(`Upload initiation failed: ${initiateResp.status}`);
  }

  const location = initiateResp.headers.get('Location');
  if (!location) throw new Error('No Location header in upload response');

  // Step 2: complete
  const uploadUrl = location.startsWith('http')
    ? `${location}?digest=${digest}`
    : `https://${registry}${location}?digest=${digest}`;

  const putResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(data.byteLength),
    },
    body: data,
  });

  if (putResp.status !== 201) {
    throw new Error(`Blob push failed: ${putResp.status} ${await putResp.text()}`);
  }
}
```

---

### 1.8 Push Manifest

```
PUT https://<registry>/v2/<name>/manifests/<reference>
Content-Type: application/vnd.oci.image.manifest.v1+json

<manifest JSON body>
```

- `<reference>` can be a tag (`latest`) or a digest
- All layer blobs referenced in the manifest must already exist in the registry

**Response:** `201 Created`

```
Location: /v2/<name>/manifests/<digest>
Docker-Content-Digest: sha256:<hex>
```

**TypeScript push example:**

```typescript
async function pushManifest(
  registry: string,
  name: string,
  reference: string,
  manifest: object,
  token: string,
): Promise<string> {
  const body = JSON.stringify(manifest);
  const response = await fetch(
    `https://${registry}/v2/${name}/manifests/${reference}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/vnd.oci.image.manifest.v1+json',
        'Content-Length': String(Buffer.byteLength(body)),
      },
      body,
    },
  );

  if (response.status !== 201) {
    throw new Error(`Manifest push failed: ${response.status} ${await response.text()}`);
  }

  return response.headers.get('Docker-Content-Digest') ?? '';
}
```

---

### 1.9 List Tags

```
GET https://<registry>/v2/<name>/tags/list
```

**Response (200 OK):**

```json
{
  "name": "library/alpine",
  "tags": ["3.18", "3.19", "latest"]
}
```

**Pagination:** Add `?n=<count>&last=<tag>`. Response includes a `Link` header:

```
Link: </v2/library/alpine/tags/list?n=100&last=latest>; rel="next"
```

**TypeScript example:**

```typescript
async function listTags(
  registry: string,
  name: string,
  token: string,
): Promise<string[]> {
  const url = `https://${registry}/v2/${name}/tags/list`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Tag list failed: ${response.status}`);
  }

  const body = await response.json() as { tags: string[] };
  return body.tags;
}
```

---

### 1.10 Media Types Reference

| Media Type | Purpose |
|-----------|---------|
| `application/vnd.oci.image.index.v1+json` | Multi-arch manifest list (OCI) |
| `application/vnd.oci.image.manifest.v1+json` | Single-arch image manifest (OCI) |
| `application/vnd.oci.image.config.v1+json` | Image config (entrypoint, env, etc.) |
| `application/vnd.oci.image.layer.v1.tar` | Uncompressed layer tarball |
| `application/vnd.oci.image.layer.v1.tar+gzip` | Gzip-compressed layer tarball (most common) |
| `application/vnd.oci.image.layer.v1.tar+zstd` | Zstd-compressed layer tarball |
| `application/vnd.oci.empty.v1+json` | Empty config/layer placeholder |
| `application/vnd.docker.distribution.manifest.v2+json` | Docker schema v2 manifest (legacy, still common) |
| `application/vnd.docker.distribution.manifest.list.v2+json` | Docker manifest list (legacy multi-arch) |

---

### 1.11 Full Auth + Pull Workflow

```typescript
import { createHash } from 'node:crypto';

interface TokenCache {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCache>();

async function getToken(
  registry: string,
  repository: string,
  action: 'pull' | 'push' | 'pull,push',
  credentials: { username: string; password: string } | null,
): Promise<string> {
  const cacheKey = `${registry}:${repository}:${action}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  // Probe to get the WWW-Authenticate challenge
  const probe = await fetch(`https://${registry}/v2/`);
  if (probe.status === 200) {
    // No auth required
    return '';
  }

  const challenge = probe.headers.get('WWW-Authenticate') ?? '';
  const realm = extractParam(challenge, 'realm');
  const service = extractParam(challenge, 'service');
  const scope = `repository:${repository}:${action}`;

  const tokenUrl = new URL(realm);
  tokenUrl.searchParams.set('service', service);
  tokenUrl.searchParams.set('scope', scope);

  const headers: Record<string, string> = {};
  if (credentials) {
    const encoded = Buffer.from(
      `${credentials.username}:${credentials.password}`,
    ).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  }

  const resp = await fetch(tokenUrl.toString(), { headers });
  if (!resp.ok) {
    throw new Error(`Token fetch failed: ${resp.status}`);
  }

  const body = await resp.json() as { token?: string; access_token?: string; expires_in?: number };
  const token = body.token ?? body.access_token ?? '';
  const expiresIn = body.expires_in ?? 60;

  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return token;
}

function extractParam(header: string, key: string): string {
  const match = new RegExp(`${key}="([^"]+)"`).exec(header);
  return match?.[1] ?? '';
}
```

---

### 1.12 OCI Error Codes

| HTTP Status | Error Code | Meaning | Action |
|-------------|------------|---------|--------|
| 400 | `BLOB_UNKNOWN` | Blob referenced but not in registry | Push the blob first |
| 400 | `BLOB_UPLOAD_INVALID` | Upload session corrupted | Start a new upload |
| 400 | `DIGEST_INVALID` | Pushed content does not match declared digest | Recompute digest |
| 400 | `MANIFEST_INVALID` | Manifest fails schema validation | Fix manifest JSON |
| 400 | `MANIFEST_UNVERIFIED` | Manifest signature verification failed | Check signing setup |
| 400 | `NAME_INVALID` | Repository name contains illegal characters | Fix name |
| 400 | `PAGINATION_NUMBER_INVALID` | `?n=` is not a valid integer | Fix query param |
| 401 | `UNAUTHORIZED` | Auth token missing or expired | Re-authenticate |
| 403 | `DENIED` | Token lacks required scope | Request correct scope |
| 404 | `BLOB_UPLOAD_UNKNOWN` | Upload UUID not found or expired | Start a new upload |
| 404 | `MANIFEST_UNKNOWN` | Manifest not found | Check tag/digest |
| 404 | `NAME_UNKNOWN` | Repository does not exist | Check repository name |
| 405 | `UNSUPPORTED` | Operation not supported by this registry | Use a different approach |
| 416 | `RANGE_INVALID` | Chunk upload range is out of order | Upload in sequence |
| 429 | `TOOMANYREQUESTS` | Rate limit exceeded | Backoff and retry |

---

### 1.13 TypeScript OCI Client Libraries — State of the Ecosystem

As of March 2026:

- **No official `oras-js` npm package exists.** The ORAS project supports Go, Python, Rust, C#, and Java — not JavaScript.
- **No `@oci/client` npm package exists.**
- **No widely-adopted TypeScript OCI registry client library** exists on npm.

**Recommendation: build a thin custom client.** The OCI Distribution Spec is simple enough that a purpose-built client covering pull, push, auth, and tag listing requires ~300 lines of TypeScript with zero dependencies beyond Node.js built-ins. The patterns in this document cover every operation needed.

Avoid pulling in full Docker daemon client libraries (e.g., `dockerode`) for registry operations — they pull in many transitive dependencies and mix socket management with registry HTTP operations.

---

## Part 2 — Extism Wasm Runtime in Node.js

### 2.1 Installation

```bash
npm install @extism/extism
```

Package: `@extism/extism`
Supported runtimes: Node.js v18+ (v20+ recommended), Deno v1.36+, Bun v1.0.7+
Node.js v18 requires `--experimental-wasi-unstable-preview1` flag.
Node.js v20+ has WASI stable; no extra flags needed.

---

### 2.2 Complete TypeScript API

#### `createPlugin(source, options)` — factory function

```typescript
import { createPlugin } from '@extism/extism';

const plugin = await createPlugin(source, options);
```

**`source`** — `ManifestLike`:

```typescript
// Load from filesystem path (Node.js only)
'path/to/plugin.wasm'

// Load from URL
'https://example.com/plugin.wasm'

// Load from raw bytes
new Uint8Array([...])

// Load from ArrayBuffer
buffer as ArrayBuffer

// Manifest object with multiple modules
{
  wasm: [
    { path: 'plugin.wasm', name: 'main' },
    { url: 'https://example.com/dep.wasm', name: 'dep' },
  ],
  config: { key: 'value' },
  memory: { maxPages: 4 },
  allowedPaths: { '/data': '/host/data/dir' },
  allowedHosts: ['api.example.com'],
  timeoutMs: 5000,
}
```

Each `ManifestWasm` entry accepts an optional `hash` field (SHA-256 hex string) for integrity verification. If `hash` is provided and the loaded bytes do not match, `createPlugin` throws.

**`options`** — `ExtismPluginOptions`:

```typescript
interface ExtismPluginOptions {
  // Enable WASI Preview 1 support (required for filesystem, env, args)
  useWasi?: boolean;

  // Filesystem paths: { guestPath: hostPath }
  // Guest sees the keys as mount points; host paths are the actual directories.
  // No read-only / read-write distinction — all preopened paths are read-write
  // by default. Access control must be enforced at the host level.
  allowedPaths?: { [guestPath: string]: string };

  // Outbound HTTP allowlist. Use ['*'] to allow all hosts.
  allowedHosts?: string[];

  // Forward WASI stdout/stderr to host process stdout/stderr (default: false)
  // When false, WASI stdout/stderr go to /dev/null.
  enableWasiOutput?: boolean;

  // Static key-value config readable by the plugin via extism_config_get
  config?: Record<string, string>;

  // Host functions exposed to the plugin
  functions?: {
    [namespace: string]: {
      [functionName: string]: (
        context: CallContext,
        ...args: bigint[]
      ) => bigint | void | Promise<bigint | void>;
    };
  };

  // Memory constraints
  memory?: {
    maxPages?: number;          // 1 page = 64 KiB; default: unlimited
    maxHttpResponseBytes?: number;  // cap on HTTP response size
    maxVarBytes?: number;       // cap on total var storage
  };

  // Call-level timeout in milliseconds (applied per plugin.call())
  timeoutMs?: number | null;

  // Run the plugin in a worker thread (experimental, isolates CPU)
  runInWorker?: boolean;

  // Log output configuration
  logger?: Console;
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

  // Expose HTTP response headers to plugins (default: false)
  allowHttpResponseHeaders?: boolean;

  // SharedArrayBuffer size for worker thread communication (bytes)
  sharedArrayBufferSize?: number;

  // Arguments passed to the Node.js worker thread (when runInWorker: true)
  nodeWorkerArgs?: {
    name?: string;
    execArgv?: string[];
    argv?: string[];
    env?: Record<string, string>;
    resourceLimits?: {
      maxOldGenerationSizeMb?: number;
      maxYoungGenerationSizeMb?: number;
      codeRangeSizeMb?: number;
      stackSizeMb?: number;
    };
  };
}
```

---

### 2.3 Plugin Lifecycle

```typescript
import { createPlugin, type Plugin } from '@extism/extism';

// Create
const plugin = await createPlugin('plugin.wasm', { useWasi: true });

// Check if a function is exported
const exists = await plugin.functionExists('process_image');

// Call an exported function
const output = await plugin.call('process_image', inputBytes);

// Read output
const text = output?.text();        // UTF-8 string
const json = output?.json();        // parsed JSON (unknown)
const bytes = output?.bytes();      // Uint8Array

// Reset plugin state (clears all vars set by the plugin, does NOT reload the module)
await plugin.reset();

// Inspect exports/imports
const exports = await plugin.getExports();
const imports = await plugin.getImports();

// Free all resources (WASI file descriptors, memory)
await plugin.close();
```

**`plugin.call()` signature:**

```typescript
call<T>(
  funcName: string,
  input?: string | number | Uint8Array,
  hostContext?: T,        // passed to host functions as context
): Promise<PluginOutput | null>
```

Returns `null` if the function returns no output.

**`PluginOutput` methods:**

```typescript
output.text()        // string (UTF-8 decode)
output.string()      // alias for text()
output.json()        // unknown (JSON.parse)
output.bytes()       // Uint8Array
output.arrayBuffer() // ArrayBuffer
// Also extends DataView for binary reads
```

---

### 2.4 WASI Filesystem

#### `allowedPaths` format

Keys are **guest paths** (what the Wasm module sees). Values are **host paths** (actual filesystem locations).

```typescript
const plugin = await createPlugin('plugin.wasm', {
  useWasi: true,
  allowedPaths: {
    '/data': 'tests/data',          // relative host path
    '/config': '/etc/my-app',       // absolute host path
    '/output': '/tmp/wasm-output',
  },
});
```

This translates directly to the Node.js `WASI` constructor's `preopens` option:

```typescript
new WASI({
  version: 'preview1',
  preopens: allowedPaths,  // same object, no transformation
  stdin,
  stdout,
  stderr,
});
```

The Wasm guest opens paths relative to the preopened directory using WASI `fd_prestat_get` / `path_open` syscalls.

#### Read-only vs read-write

There is no built-in read-only mounting in Extism's `allowedPaths`. The Node.js WASI implementation passes the `preopens` object directly without permission flags. To enforce read-only access:

1. Point the host path to a directory owned by a different user with read-only permissions at the OS level.
2. Alternatively, copy files to a temp directory before the call and check after for modifications.

This is a limitation of WASI Preview 1 — there is no `O_RDONLY` distinction in the preopen model.

#### WASI Preview 1 supported filesystem operations

WASI Preview 1 (as implemented in Node.js v20+) supports:

- `path_open` — open files and directories
- `fd_read` / `fd_write` — read and write file descriptors
- `fd_seek` / `fd_tell` — seek within files
- `fd_close` — close file descriptors
- `fd_stat` / `path_filestat_get` — file metadata
- `fd_readdir` — directory listing
- `path_create_directory` / `path_remove_directory`
- `path_unlink_file` — delete files
- `path_rename` — rename files
- `path_symlink` / `path_readlink`
- `fd_prestat_get` / `fd_prestat_dir_name` — enumerate preopened dirs

Operations **not** available in WASI Preview 1:
- Sockets / network (handled by Extism's host HTTP functions instead)
- `mmap`
- Unix signals
- Forking

#### `enableWasiOutput`

Controls whether the WASM module's `stdout` and `stderr` reach the host process output.

```typescript
// stdout/stderr from WASM go to /dev/null (default)
const plugin = await createPlugin('plugin.wasm', {
  useWasi: true,
  enableWasiOutput: false,
});

// stdout/stderr from WASM print to Node.js stdout/stderr
const plugin = await createPlugin('plugin.wasm', {
  useWasi: true,
  enableWasiOutput: true,
});
```

There is no API to capture WASI stdout as a string — `enableWasiOutput: true` routes it to the host file descriptors 1 and 2. If you need to capture output, the plugin should write to a file via `allowedPaths` and read the file after `plugin.call()`.

The primary output mechanism Extism intends is the return value of `plugin.call()` (the plugin writes to Extism's shared memory, not to stdout).

---

### 2.5 Host Functions

Host functions let TypeScript code expose capabilities to the Wasm plugin. The plugin calls them as imported functions.

```typescript
import { createPlugin, type CallContext } from '@extism/extism';

const kvStore = new Map<string, Uint8Array>();

const plugin = await createPlugin('plugin.wasm', {
  useWasi: true,
  functions: {
    // Namespace must match what the Wasm module imports
    'extism:host/user': {
      // Read a value from KV store; return offset into plugin memory
      kv_read(context: CallContext, keyOffset: bigint): bigint {
        const key = context.read(keyOffset).text();
        const value = kvStore.get(key) ?? new Uint8Array(0);
        return context.store(value);
      },

      // Write a value to KV store
      kv_write(context: CallContext, keyOffset: bigint, valueOffset: bigint): void {
        const key = context.read(keyOffset).text();
        const value = context.read(valueOffset).bytes();
        kvStore.set(key, value);
      },
    },
  },
});
```

**`CallContext` methods:**

```typescript
context.read(offset: bigint): PluginOutput   // read bytes from plugin memory at offset
context.store(data: Uint8Array): bigint       // write bytes into plugin memory, return offset
```

Host function parameters and return values are `bigint` (WebAssembly i64). Extism uses these as memory offsets into the plugin's linear memory. Use `context.read()` to decode them into actual data.

**Async host functions** are supported:

```typescript
'extism:host/user': {
  async fetch_url(context: CallContext, urlOffset: bigint): Promise<bigint> {
    const url = context.read(urlOffset).text();
    const resp = await fetch(url);
    const body = new Uint8Array(await resp.arrayBuffer());
    return context.store(body);
  },
},
```

**Host context** — pass arbitrary data to host functions per-call without global state:

```typescript
interface RequestContext {
  requestId: string;
  userId: string;
}

const ctx: RequestContext = { requestId: 'req-1', userId: 'user-42' };
const output = await plugin.call('handle_request', inputBytes, ctx);

// In the host function:
'extism:host/user': {
  log_event(context: CallContext<RequestContext>, msgOffset: bigint): void {
    const msg = context.read(msgOffset).text();
    console.log(`[${context.hostContext.requestId}] ${msg}`);
  },
},
```

---

### 2.6 Memory Limits

```typescript
const plugin = await createPlugin('plugin.wasm', {
  memory: {
    // Maximum WebAssembly linear memory (1 page = 65,536 bytes)
    maxPages: 16,          // 16 * 64 KiB = 1 MiB

    // Maximum bytes Extism vars can consume across all plugin.call() invocations
    maxVarBytes: 1024 * 1024,   // 1 MiB

    // Maximum bytes a single HTTP response can be (for extism host HTTP)
    maxHttpResponseBytes: 10 * 1024 * 1024,  // 10 MiB
  },
});
```

When `maxPages` is exceeded, the Wasm module's `memory.grow` instruction fails, causing the plugin to trap. The call throws an error.

---

### 2.7 Timeouts

```typescript
const plugin = await createPlugin('plugin.wasm', {
  timeoutMs: 5000,  // 5 seconds per plugin.call()
});
```

`timeoutMs` applies per `plugin.call()` invocation. If the call does not complete within the deadline, it throws with a timeout error. The plugin instance is still usable after a timeout (the Wasm module state may be undefined; call `plugin.reset()` before reuse).

---

### 2.8 Plugin Config

Config is a static key-value store passed at plugin creation, readable by the plugin via the Extism guest SDK (`extism_config_get`). Values cannot be changed after creation.

```typescript
const plugin = await createPlugin('plugin.wasm', {
  config: {
    api_base_url: 'https://api.example.com',
    max_retries: '3',
    feature_flag_x: 'true',
  },
});
```

All values must be strings. If the plugin reads an absent key, it receives `null` / empty.

---

### 2.9 Complete Example — Wasm Container Runtime

This example pulls a Wasm OCI image, extracts the `.wasm` binary, and runs it with Extism.

```typescript
import { createPlugin, type CallContext } from '@extism/extism';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---- OCI Pull ----

interface OCIManifest {
  schemaVersion: number;
  mediaType: string;
  config: { mediaType: string; digest: string; size: number };
  layers: Array<{ mediaType: string; digest: string; size: number }>;
}

async function getRegistryToken(
  registry: string,
  repository: string,
  action: 'pull' | 'push' | 'pull,push',
  creds: { username: string; password: string } | null,
): Promise<string> {
  const probe = await fetch(`https://${registry}/v2/`);
  if (probe.status === 200) return '';

  const challenge = probe.headers.get('WWW-Authenticate') ?? '';
  const realm = /realm="([^"]+)"/.exec(challenge)?.[1] ?? '';
  const service = /service="([^"]+)"/.exec(challenge)?.[1] ?? '';
  const scope = `repository:${repository}:${action}`;

  const url = new URL(realm);
  url.searchParams.set('service', service);
  url.searchParams.set('scope', scope);

  const headers: Record<string, string> = {};
  if (creds) {
    headers['Authorization'] = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`Token error: ${resp.status}`);
  const body = await resp.json() as { token?: string; access_token?: string };
  return body.token ?? body.access_token ?? '';
}

async function pullWasmBlob(
  registry: string,
  repository: string,
  tag: string,
  creds: { username: string; password: string } | null,
): Promise<Uint8Array> {
  const token = await getRegistryToken(registry, repository, 'pull', creds);
  const authHeader = token ? `Bearer ${token}` : '';

  // Fetch manifest
  const manifestResp = await fetch(
    `https://${registry}/v2/${repository}/manifests/${tag}`,
    {
      headers: {
        ...(authHeader && { Authorization: authHeader }),
        Accept: [
          'application/vnd.oci.image.manifest.v1+json',
          'application/vnd.docker.distribution.manifest.v2+json',
        ].join(', '),
      },
    },
  );

  if (!manifestResp.ok) {
    throw new Error(`Manifest fetch failed: ${manifestResp.status}`);
  }

  const manifest = await manifestResp.json() as OCIManifest;

  // Pull the first layer (for single-layer Wasm images this is the .wasm blob)
  const layer = manifest.layers[0];
  if (!layer) throw new Error('Manifest has no layers');

  const blobResp = await fetch(
    `https://${registry}/v2/${repository}/blobs/${layer.digest}`,
    { headers: authHeader ? { Authorization: authHeader } : {} },
  );

  if (!blobResp.ok) throw new Error(`Blob fetch failed: ${blobResp.status}`);

  const data = new Uint8Array(await blobResp.arrayBuffer());

  // Verify digest
  const [algo, expectedHex] = layer.digest.split(':') as [string, string];
  const actualHex = createHash(algo).update(data).digest('hex');
  if (actualHex !== expectedHex) {
    throw new Error(`Digest mismatch: expected ${layer.digest}, got ${algo}:${actualHex}`);
  }

  return data;
}

// ---- Run with Extism ----

async function runWasmPlugin(wasmBytes: Uint8Array, input: string): Promise<string> {
  const plugin = await createPlugin(wasmBytes, {
    useWasi: true,
    enableWasiOutput: false,
    allowedPaths: {
      '/tmp': '/tmp',
    },
    config: {
      log_level: 'info',
    },
    memory: {
      maxPages: 32,         // 2 MiB
      maxVarBytes: 512 * 1024,
    },
    timeoutMs: 10_000,
    functions: {
      'extism:host/user': {
        log(context: CallContext, msgOffset: bigint): void {
          console.log('[wasm]', context.read(msgOffset).text());
        },
      },
    },
  });

  try {
    const output = await plugin.call('run', input);
    return output?.text() ?? '';
  } finally {
    await plugin.close();
  }
}

// ---- Main ----

const wasmBytes = await pullWasmBlob(
  'ghcr.io',
  'myorg/my-wasm-plugin',
  'latest',
  null,  // pass credentials if needed
);

const result = await runWasmPlugin(wasmBytes, JSON.stringify({ key: 'value' }));
console.log('Plugin output:', result);
```

---

### 2.10 Error Handling Patterns

```typescript
import { createPlugin } from '@extism/extism';

// Plugin creation failure (bad Wasm, hash mismatch, missing imports)
let plugin;
try {
  plugin = await createPlugin('plugin.wasm', { useWasi: true });
} catch (err) {
  if (err instanceof Error) {
    console.error('Failed to load plugin:', err.message);
  }
  throw err;
}

// Call failure (timeout, trap, function not found)
try {
  const output = await plugin.call('process', input);
  if (output === null) {
    // Plugin returned no output — check if that's expected
  }
} catch (err) {
  if (err instanceof Error) {
    if (err.message.includes('timeout')) {
      // Timeout — plugin state may be corrupted, reset before reuse
      await plugin.reset();
    } else if (err.message.includes('unreachable')) {
      // Wasm trap — plugin hit an unreachable instruction (crash/abort)
    }
    console.error('Plugin call failed:', err.message);
  }
} finally {
  await plugin.close();
}

// Check function existence before calling
if (await plugin.functionExists('optional_feature')) {
  await plugin.call('optional_feature', data);
}
```

---

## Part 3 — Quick Reference

### OCI Registry Endpoints Summary

| Operation | Method | Path |
|-----------|--------|------|
| Version check / auth probe | `GET` | `/v2/` |
| Pull manifest | `GET` | `/v2/<name>/manifests/<ref>` |
| Check manifest | `HEAD` | `/v2/<name>/manifests/<ref>` |
| Push manifest | `PUT` | `/v2/<name>/manifests/<ref>` |
| Pull blob | `GET` | `/v2/<name>/blobs/<digest>` |
| Check blob | `HEAD` | `/v2/<name>/blobs/<digest>` |
| Initiate blob upload | `POST` | `/v2/<name>/blobs/uploads/` |
| Complete blob upload | `PUT` | `<location>?digest=<digest>` |
| List tags | `GET` | `/v2/<name>/tags/list` |

### Extism `createPlugin` Options Summary

| Option | Type | Purpose |
|--------|------|---------|
| `useWasi` | `boolean` | Enable WASI Preview 1 |
| `allowedPaths` | `{ guestPath: hostPath }` | Mount host directories into Wasm guest |
| `enableWasiOutput` | `boolean` | Forward WASM stdout/stderr to host (default: false) |
| `config` | `Record<string, string>` | Static key-value config readable by plugin |
| `functions` | `{ ns: { fn: handler } }` | Host functions imported by the Wasm module |
| `memory.maxPages` | `number` | Max Wasm linear memory pages (1 page = 64 KiB) |
| `memory.maxVarBytes` | `number` | Max bytes across all plugin vars |
| `timeoutMs` | `number \| null` | Per-call timeout in milliseconds |
| `runInWorker` | `boolean` | Run in separate Node.js worker thread (experimental) |
| `allowedHosts` | `string[]` | Outbound HTTP allowlist for Extism HTTP host functions |
| `logLevel` | `LogLevel` | Log verbosity |

### Known Gaps and Warnings

- `allowedPaths` **does not support read-only mounts** — all preopened paths are writable. Enforce at the OS level.
- `enableWasiOutput: true` routes WASM stdout/stderr to host stdout/stderr. There is **no API to capture WASM stdout as a string**. Use the `plugin.call()` return value instead.
- `runInWorker: true` is marked experimental. It runs the Wasm module in a Node.js `worker_threads` Worker and uses `SharedArrayBuffer` for communication. Requires `crossOriginIsolated` in browser contexts; in Node.js it works without additional flags.
- The `hash` field on `ManifestWasm` is a SHA-256 hex string. If it does not match the loaded bytes, `createPlugin` throws synchronously during module compilation.
- `plugin.reset()` clears Extism variables (values stored with `extism_var_set` by the plugin). It does **not** reload the Wasm module or reset WebAssembly globals/memory.
- Calling `plugin.call()` on a closed plugin throws. Always call `plugin.close()` in a `finally` block.
