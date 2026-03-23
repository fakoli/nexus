import { createSignal, For, onMount, Show } from "solid-js";
import { gateway } from "../../stores/app";
import { Button, Badge, Card, Input } from "../../design/components";
import { tokens as t } from "../../design/tokens";
import type { InstalledPlugin, MarketplaceEntry } from "../../gateway/types";

export default function PluginManager() {
  const [installed, setInstalled]     = createSignal<InstalledPlugin[]>([]);
  const [results, setResults]         = createSignal<MarketplaceEntry[]>([]);
  const [query, setQuery]             = createSignal("");
  const [searching, setSearching]     = createSignal(false);
  const [actionId, setActionId]       = createSignal<string | null>(null);
  const [error, setError]             = createSignal<string | null>(null);

  onMount(() => { void loadInstalled(); });

  async function loadInstalled() {
    try {
      const payload = await gateway.request("plugins.list", {});
      setInstalled((payload.plugins as InstalledPlugin[] | undefined) ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSearch() {
    if (!query().trim()) return;
    setSearching(true);
    setError(null);
    try {
      const payload = await gateway.request("plugins.search", { query: query().trim() });
      setResults((payload.results as MarketplaceEntry[] | undefined) ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function handleInstall(id: string) {
    setActionId(id);
    setError(null);
    try {
      await gateway.request("plugins.install", { id });
      await loadInstalled();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionId(null);
    }
  }

  async function handleUninstall(id: string) {
    setActionId(id);
    setError(null);
    try {
      await gateway.request("plugins.uninstall", { id });
      await loadInstalled();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionId(null);
    }
  }

  function isInstalled(id: string): boolean {
    return installed().some((p) => p.id === id);
  }

  function statusVariant(status: InstalledPlugin["status"]): "success" | "error" | "default" {
    if (status === "active") return "success";
    if (status === "error") return "error";
    return "default";
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: t.space.lg, padding: t.space.md, height: "100%", "overflow-y": "auto" }}>
      <span style={{ "font-size": t.font.sizeXl, "font-weight": t.font.weightBold, color: t.color.text }}>Plugin Manager</span>

      <Show when={error()}>
        <div style={{ background: "rgba(244,67,54,0.1)", border: `1px solid ${t.color.error}`, "border-radius": t.radius.md, padding: t.space.sm, "font-size": t.font.sizeSm, color: t.color.error }}>
          {error()}
        </div>
      </Show>

      {/* Installed Plugins */}
      <Card title="Installed">
        <Show when={installed().length === 0}>
          <div style={{ color: t.color.textMuted, "font-size": t.font.sizeMd, "text-align": "center", padding: t.space.lg }}>
            No plugins installed.
          </div>
        </Show>
        <div style={{ display: "flex", "flex-direction": "column", gap: t.space.sm }}>
          <For each={installed()}>{(plugin) => (
            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: t.space.sm, background: t.color.bgHover, "border-radius": t.radius.md }}>
              <div style={{ display: "flex", "flex-direction": "column", gap: t.space.xs }}>
                <span style={{ "font-weight": t.font.weightMedium, color: t.color.text }}>{plugin.name}</span>
                <div style={{ display: "flex", "align-items": "center", gap: t.space.sm }}>
                  <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, "font-family": t.font.familyMono }}>v{plugin.version}</span>
                  <Badge variant={statusVariant(plugin.status)}>{plugin.status}</Badge>
                </div>
              </div>
              <Button variant="ghost" style={{ "font-size": t.font.sizeSm, color: t.color.error }}
                loading={actionId() === plugin.id}
                onClick={() => void handleUninstall(plugin.id)}>
                Uninstall
              </Button>
            </div>
          )}</For>
        </div>
      </Card>

      {/* Marketplace */}
      <Card title="Marketplace">
        <div style={{ display: "flex", gap: t.space.sm, "margin-bottom": t.space.md }}>
          <div style={{ flex: "1" }}>
            <Input placeholder="Search plugins…" value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)} />
          </div>
          <Button loading={searching()} onClick={() => void handleSearch()}>Search</Button>
        </div>

        <Show when={results().length === 0 && !searching()}>
          <div style={{ color: t.color.textMuted, "font-size": t.font.sizeSm, "text-align": "center", padding: t.space.md }}>
            Enter a search term to find plugins.
          </div>
        </Show>

        <div style={{ display: "flex", "flex-direction": "column", gap: t.space.sm }}>
          <For each={results()}>{(entry) => (
            <div style={{ display: "flex", "align-items": "flex-start", "justify-content": "space-between", padding: t.space.sm, background: t.color.bgHover, "border-radius": t.radius.md }}>
              <div style={{ display: "flex", "flex-direction": "column", gap: t.space.xs, "max-width": "75%" }}>
                <div style={{ display: "flex", "align-items": "center", gap: t.space.sm }}>
                  <span style={{ "font-weight": t.font.weightMedium, color: t.color.text }}>{entry.name}</span>
                  <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, "font-family": t.font.familyMono }}>v{entry.version}</span>
                </div>
                <span style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>{entry.description}</span>
                <span style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>by {entry.author}</span>
              </div>
              <Show when={!isInstalled(entry.id)}
                fallback={<Badge variant="success">installed</Badge>}>
                <Button variant="secondary" style={{ "font-size": t.font.sizeSm }}
                  loading={actionId() === entry.id}
                  onClick={() => void handleInstall(entry.id)}>
                  Install
                </Button>
              </Show>
            </div>
          )}</For>
        </div>
      </Card>
    </div>
  );
}
