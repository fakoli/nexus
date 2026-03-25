import { type Component, createSignal, For, Show } from "solid-js";
import { store, gateway } from "../../stores/app";
import { tokens as t } from "../../design/tokens";
import { Badge, Button, Card, Input } from "../../design/components";
import type { SkillInfo } from "../../gateway/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function sourceBadgeVariant(s: SkillInfo["source"]): "success" | "info" | "warning" {
  switch (s) {
    case "bundled":   return "info";
    case "managed":   return "success";
    case "workspace": return "warning";
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export const SkillsView: Component = () => {
  const [query, setQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<SkillInfo[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [installing, setInstalling] = createSignal<string | null>(null);
  const [error, setError] = createSignal("");

  const skills = () => store.skills.available;

  const filtered = (): SkillInfo[] => {
    const q = query().toLowerCase().trim();
    if (!q) return skills();
    return skills().filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.triggers.some((trig) => trig.toLowerCase().includes(q)),
    );
  };

  const handleSearch = async (): Promise<void> => {
    const q = query().trim();
    if (!q) return;
    setSearching(true);
    setError("");
    try {
      const res = await gateway.request("skills.search", { query: q });
      const items = Array.isArray(res.skills) ? (res.skills as SkillInfo[]) : [];
      setSearchResults(items);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Search failed";
      setError(msg);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleInstall = async (skillId: string): Promise<void> => {
    setInstalling(skillId);
    setError("");
    try {
      await gateway.request("skills.install", { skillId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Install failed";
      setError(msg);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div style={{
      padding: t.space.lg, "max-width": "800px",
      margin: "0 auto", display: "flex",
      "flex-direction": "column", gap: t.space.lg,
    }}>
      <h2 style={{
        margin: "0", color: t.color.text,
        "font-size": t.font.sizeXl,
        "font-family": t.font.family,
      }}>
        Skills
      </h2>

      {/* Search bar */}
      <Card title="Search ClawHub">
        <div style={{ display: "flex", gap: t.space.sm, "align-items": "flex-end" }}>
          <div style={{ flex: "1" }}>
            <Input
              placeholder="Search skills..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </div>
          <Button onClick={handleSearch} loading={searching()}>
            Search
          </Button>
        </div>

        <Show when={error()}>
          <span style={{ color: t.color.error, "font-size": t.font.sizeSm }}>
            {error()}
          </span>
        </Show>

        {/* Search results */}
        <Show when={searchResults().length > 0}>
          <div style={{
            "margin-top": t.space.md, display: "flex",
            "flex-direction": "column", gap: t.space.sm,
          }}>
            <For each={searchResults()}>
              {(skill) => (
                <SkillRow
                  skill={skill}
                  installing={installing() === skill.id}
                  onInstall={() => handleInstall(skill.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </Card>

      {/* Installed skills */}
      <Card title="Available Skills">
        <Show
          when={filtered().length > 0}
          fallback={
            <p style={{ color: t.color.textDim, margin: "0" }}>
              No skills available.
            </p>
          }
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: t.space.sm }}>
            <For each={filtered()}>
              {(skill) => <SkillRow skill={skill} />}
            </For>
          </div>
        </Show>
      </Card>
    </div>
  );
};

// ── Skill row ────────────────────────────────────────────────────────────────

interface SkillRowProps {
  skill: SkillInfo;
  installing?: boolean;
  onInstall?: () => void;
}

const SkillRow: Component<SkillRowProps> = (props) => (
  <div style={{
    display: "flex", "align-items": "center", gap: t.space.md,
    padding: t.space.sm, background: t.color.bgHover,
    "border-radius": t.radius.md, "border": `1px solid ${t.color.border}`,
  }}>
    <div style={{ flex: "1", "min-width": "0" }}>
      <div style={{ display: "flex", "align-items": "center", gap: t.space.sm }}>
        <span style={{
          color: t.color.text, "font-weight": t.font.weightBold,
          "font-size": t.font.sizeMd,
        }}>
          {props.skill.name}
        </span>
        <Badge variant={sourceBadgeVariant(props.skill.source)}>
          {props.skill.source}
        </Badge>
      </div>
      <p style={{
        margin: `${t.space.xs} 0 0`, color: t.color.textMuted,
        "font-size": t.font.sizeSm, "line-height": "1.4",
      }}>
        {props.skill.description}
      </p>
      <Show when={props.skill.triggers.length > 0}>
        <div style={{
          display: "flex", gap: t.space.xs, "margin-top": t.space.xs,
          "flex-wrap": "wrap",
        }}>
          <For each={props.skill.triggers}>
            {(trigger) => (
              <span style={{
                "font-size": "10px", padding: "1px 6px",
                "border-radius": t.radius.sm,
                background: t.color.bgCard, color: t.color.textDim,
                "font-family": t.font.familyMono,
                border: `1px solid ${t.color.border}`,
              }}>
                {trigger}
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
    <Show when={props.onInstall}>
      <Button
        variant="secondary"
        onClick={props.onInstall}
        loading={props.installing}
      >
        Install
      </Button>
    </Show>
  </div>
);

export default SkillsView;
