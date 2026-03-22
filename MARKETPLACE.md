# Nexus Plugin Marketplace

The Nexus plugin marketplace lets you discover, install, and manage plugins that
extend the Nexus gateway.  Plugins are distributed through *registries* — any
HTTP(S) server that hosts a `registry.json` index file.

---

## How the marketplace works

1. A *registry* is a URL that serves `registry.json` at its root (e.g.
   `https://example.com/my-registry/registry.json`).
2. `nexus plugins search <query>` fetches the index from every configured
   registry and filters results by the query term.
3. `nexus plugins install <id>` records the plugin in the local config store
   (via `@nexus/core` `setConfig`/`getConfig`) so it persists across restarts.
4. Installed plugin manifests are stored under the config key
   `plugins.installed` and registry URLs under `plugins.registries`.

The default registry is: `https://github.com/fakoli/fakoli-plugins`

---

## CLI quick reference

```
nexus plugins list                    List installed plugins
nexus plugins search <query>          Search all registries for plugins
nexus plugins install <id>            Install a plugin by ID
nexus plugins update [id]             Update one or all installed plugins
nexus plugins uninstall <id>          Remove an installed plugin
nexus plugins info <id>               Show detailed plugin information

nexus plugins registry list           List configured registries
nexus plugins registry add <url>      Add a registry (validates connectivity)
nexus plugins registry remove <url>   Remove a registry
```

Add `--json` to any command to get machine-readable output.

---

## Adding a registry

```bash
nexus plugins registry add https://example.com/my-registry
```

Before saving, the CLI fetches `<url>/registry.json` and validates the
response shape.  If the URL is unreachable or returns malformed JSON the
command exits with a descriptive error.

To remove a registry:

```bash
nexus plugins registry remove https://example.com/my-registry
```

Removing the last configured registry automatically restores the default.

---

## Creating a plugin for the marketplace

### 1. Directory layout

```
my-plugin/
  package.json       (standard npm manifest — must have "name" and "version")
  nexus-plugin.json  (Nexus plugin manifest — see below)
  index.js           (entry point declared in nexus-plugin.json "main")
  ...
```

### 2. Plugin manifest — `nexus-plugin.json`

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

| Field          | Required | Description                                          |
|----------------|----------|------------------------------------------------------|
| `id`           | yes      | Globally unique slug (`scope/name` recommended)      |
| `name`         | yes      | Human-readable display name                          |
| `version`      | yes      | SemVer string                                        |
| `description`  | yes      | Short description (shown in `nexus plugins list`)    |
| `main`         | yes      | Entry-point JS file relative to the plugin root      |
| `author`       | no       | Author name / email                                  |
| `license`      | no       | SPDX license identifier                              |
| `homepage`     | no       | URL to documentation or source                       |
| `keywords`     | no       | Array of search keywords                             |
| `nexusVersion` | no       | SemVer range of compatible Nexus versions            |

### 3. Publishing to a registry

To make your plugin discoverable, add it to a `registry.json` hosted at a
publicly accessible URL:

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
      "homepage": "https://github.com/my-org/my-plugin"
    }
  ]
}
```

### Registry index format — `registry.json`

| Field       | Type     | Description                                        |
|-------------|----------|----------------------------------------------------|
| `version`   | string   | Schema version — currently `"1"`                   |
| `updatedAt` | string   | ISO-8601 timestamp of the last index update        |
| `plugins`   | object[] | Array of registry entries (see table below)        |

Each entry in `plugins`:

| Field         | Required | Description                                            |
|---------------|----------|--------------------------------------------------------|
| `id`          | yes      | Unique plugin identifier (matches `nexus-plugin.json`) |
| `name`        | yes      | Display name                                           |
| `version`     | yes      | Current published version                              |
| `description` | yes      | Short description                                      |
| `tarball`     | yes      | URL to the `.tgz` archive of the plugin                |
| `author`      | no       | Author name                                            |
| `license`     | no       | SPDX identifier                                        |
| `homepage`    | no       | Documentation URL                                      |
| `keywords`    | no       | Search keywords                                        |

---

## Security considerations

- Always host `registry.json` over HTTPS.
- The CLI validates that the registry URL is reachable and returns a
  well-formed index before saving it.
- Plugins run inside the Nexus gateway process — review plugin source before
  installing from untrusted registries.
