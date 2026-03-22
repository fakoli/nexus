# Plugin Authoring and Publishing

Nexus plugins extend the gateway at runtime without modifying core source code. A plugin can register new RPC methods, add tools, react to events, or provide custom middleware.

For a quick reference on the CLI commands used to manage plugins, see [MARKETPLACE.md](../MARKETPLACE.md).

---

## Plugin Directory Layout

```
my-plugin/
  package.json        — standard npm manifest
  nexus-plugin.json   — Nexus plugin manifest (required)
  index.js            — entry point (declared in nexus-plugin.json "main")
  ...
```

---

## Plugin Manifest — `nexus-plugin.json`

```json
{
  "id": "my-org/my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A one-line description shown in search results.",
  "author": "Your Name <you@example.com>",
  "license": "MIT",
  "homepage": "https://github.com/my-org/my-plugin",
  "keywords": ["keyword1", "keyword2"],
  "nexusVersion": ">=0.1.0",
  "main": "index.js"
}
```

| Field | Required | Description |
|---|---|---|
| `id` | yes | Globally unique slug. Use `scope/name` format. |
| `name` | yes | Human-readable display name |
| `version` | yes | SemVer string |
| `description` | yes | Short description (shown in `nexus plugins list`) |
| `main` | yes | Entry-point JS file, relative to the plugin root |
| `author` | no | Author name and email |
| `license` | no | SPDX license identifier |
| `homepage` | no | URL to documentation or source |
| `keywords` | no | Array of search keywords |
| `nexusVersion` | no | SemVer range of compatible Nexus versions (e.g. `">=0.1.0"`) |

---

## Plugin Entry Point

The entry point is loaded by the Nexus plugin loader with dynamic `import()`. It must export a `setup` function:

```javascript
// index.js
export async function setup(ctx) {
  // ctx is the PluginContext object
}
```

### `PluginContext` API

The `ctx` object passed to `setup` provides the following:

```typescript
interface PluginContext {
  /** Plugin manifest */
  manifest: PluginManifest;

  /** Register an RPC handler for a new method */
  registerHandler(method: string, handler: RpcHandler): void;

  /** Register a new agent tool */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void;

  /** Subscribe to gateway events */
  on(event: string, listener: (payload: unknown) => void): void;

  /** Read a config value from the Nexus config store */
  getConfig(key: string): unknown;

  /** Write a config value to the Nexus config store */
  setConfig(key: string, value: unknown): void;

  /** Structured logger scoped to this plugin */
  log: Logger;
}
```

---

## Example: Registering a Custom Tool

```javascript
// index.js
export async function setup(ctx) {
  const { z } = await import("zod");

  ctx.registerTool(
    {
      name: "my_tool",
      description: "Does something useful",
      inputSchema: z.object({
        input: z.string().describe("The input value"),
      }),
    },
    async ({ input }) => {
      return { output: input.toUpperCase() };
    },
  );

  ctx.log.info("my-plugin tools registered");
}
```

---

## Example: Registering a Custom RPC Method

```javascript
// index.js
export async function setup(ctx) {
  ctx.registerHandler("myplugin.greet", async (params) => {
    const name = typeof params.name === "string" ? params.name : "world";
    return { ok: true, payload: { message: `Hello, ${name}!` } };
  });
}
```

Clients can then call `myplugin.greet` over WebSocket like any built-in method.

---

## Installing a Plugin Locally

```bash
# Install from a local directory
nexus plugins install /path/to/my-plugin

# Install from a tarball URL
nexus plugins install https://example.com/releases/my-plugin-1.0.0.tgz

# Install by ID (searches all configured registries)
nexus plugins install my-org/my-plugin
```

---

## Publishing to a Registry

A registry is any HTTPS server that hosts a `registry.json` file. The format is:

```json
{
  "version": "1",
  "updatedAt": "2026-03-22T00:00:00Z",
  "plugins": [
    {
      "id": "my-org/my-plugin",
      "name": "My Plugin",
      "version": "1.0.0",
      "description": "A one-line description.",
      "author": "Your Name",
      "keywords": ["keyword1"],
      "tarball": "https://example.com/releases/my-plugin-1.0.0.tgz",
      "homepage": "https://github.com/my-org/my-plugin",
      "license": "MIT"
    }
  ]
}
```

Steps:

1. Package your plugin as a `.tgz`: `npm pack` produces `my-plugin-1.0.0.tgz`.
2. Upload the tarball to a publicly accessible HTTPS URL.
3. Add an entry to `registry.json` with the tarball URL.
4. Host `registry.json` at a stable HTTPS URL.
5. Share the registry URL so others can add it:
   ```bash
   nexus plugins registry add https://example.com/my-registry
   ```

The default Nexus registry is `https://github.com/fakoli/fakoli-plugins`.

---

## Security Considerations

- Plugins run inside the Nexus gateway process with the same privileges.
- Always review plugin source before installing from an untrusted registry.
- Only add registries you trust — the CLI validates connectivity but does not audit plugin code.
- Prefer plugins that use `ctx.registerTool` and `ctx.registerHandler` over those that use direct `import` of internal Nexus modules, as internal APIs may change.
