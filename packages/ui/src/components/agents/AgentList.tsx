import { createSignal, For, onMount, Show } from "solid-js";
import { store } from "../../stores/app";
import { loadAgents, createAgent, deleteAgent } from "../../stores/agent-actions";
import { Button, Badge, Card, Modal, Input, Select } from "../../design/components";
import { tokens as t } from "../../design/tokens";
import type { Agent } from "../../gateway/types";

interface AgentListProps {
  selectedId: string;
  onSelect: (id: string) => void;
}

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai",    label: "OpenAI" },
  { value: "google",    label: "Google" },
  { value: "groq",      label: "Groq" },
];

export default function AgentList(props: AgentListProps) {
  const [showCreate, setShowCreate] = createSignal(false);
  const [newId, setNewId]           = createSignal("");
  const [newProvider, setNewProvider] = createSignal("anthropic");
  const [newModel, setNewModel]     = createSignal("");
  const [creating, setCreating]     = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);

  onMount(() => { void loadAgents(); });

  async function handleCreate() {
    if (!newId().trim() || !newModel().trim()) return;
    setCreating(true);
    await createAgent(newId().trim(), { provider: newProvider(), model: newModel().trim() });
    setCreating(false);
    setShowCreate(false);
    setNewId(""); setNewModel("");
  }

  async function handleDelete(id: string) {
    await deleteAgent(id);
    setConfirmDelete(null);
    if (props.selectedId === id) props.onSelect("");
  }

  function statusVariant(a: Agent): "success" | "default" {
    return a.id === store.session.agentId ? "success" : "default";
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: t.space.md, padding: t.space.md, height: "100%", "overflow-y": "auto" }}>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "flex-shrink": "0" }}>
        <span style={{ "font-size": t.font.sizeXl, "font-weight": t.font.weightBold, color: t.color.text }}>Agents</span>
        <Button onClick={() => setShowCreate(true)}>+ Create Agent</Button>
      </div>

      <Show when={store.agents.length === 0}>
        <div style={{ color: t.color.textMuted, "font-size": t.font.sizeMd, "text-align": "center", padding: t.space.xxl }}>
          No agents configured. Create one to get started.
        </div>
      </Show>

      <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(240px, 1fr))", gap: t.space.md }}>
        <For each={store.agents}>{(agent) => (
          <Card style={{
            cursor: "pointer",
            border: `1px solid ${props.selectedId === agent.id ? t.color.accent : t.color.border}`,
            transition: `border-color ${t.transition.normal}`,
          }}>
            <div onClick={() => props.onSelect(agent.id)} style={{ display: "flex", "flex-direction": "column", gap: t.space.sm }}>
              <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                <span style={{ "font-weight": t.font.weightBold, color: t.color.text, "font-size": t.font.sizeMd }}>{agent.id}</span>
                <Badge variant={statusVariant(agent)}>{agent.id === store.session.agentId ? "active" : "idle"}</Badge>
              </div>
              <div style={{ "font-size": t.font.sizeSm, color: t.color.textMuted }}>
                {agent.provider} / {agent.model}
              </div>
              <div style={{ "font-size": t.font.sizeSm, color: t.color.textDim }}>
                {agent.name || agent.id}
              </div>
            </div>
            <div style={{ "margin-top": t.space.sm, "padding-top": t.space.sm, "border-top": `1px solid ${t.color.border}`, display: "flex", "justify-content": "flex-end" }}>
              <Button variant="ghost" style={{ "font-size": t.font.sizeSm, color: t.color.error }}
                onClick={() => setConfirmDelete(agent.id)}>
                Delete
              </Button>
            </div>
          </Card>
        )}</For>
      </div>

      {/* Create Agent Modal */}
      <Modal title="Create Agent" open={showCreate()} onClose={() => setShowCreate(false)}
        actions={<>
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button loading={creating()} onClick={() => void handleCreate()}>Create</Button>
        </>}>
        <div style={{ display: "flex", "flex-direction": "column", gap: t.space.md }}>
          <Input label="Agent ID" placeholder="e.g. my-agent" value={newId()} onInput={(e) => setNewId(e.currentTarget.value)} />
          <Select label="Provider" value={newProvider()} options={PROVIDER_OPTIONS} onChange={(e) => setNewProvider(e.currentTarget.value)} />
          <Input label="Model" placeholder="e.g. claude-opus-4-5" value={newModel()} onInput={(e) => setNewModel(e.currentTarget.value)} />
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal title="Delete Agent" open={confirmDelete() !== null} onClose={() => setConfirmDelete(null)}
        actions={<>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button style={{ background: t.color.error }} onClick={() => { const id = confirmDelete(); if (id) void handleDelete(id); }}>Delete</Button>
        </>}>
        <p style={{ color: t.color.text }}>Delete agent <strong>{confirmDelete()}</strong>? This cannot be undone.</p>
      </Modal>
    </div>
  );
}
