import { type Component, For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { gateway } from "../../stores/app";
import { tokens as t } from "../../design/tokens";
import { Button } from "../../design/components";
import type { EventFrame, RequestMethod } from "../../gateway/types";

// ── Known methods for autocomplete ───────────────────────────────────────────

const KNOWN_METHODS: RequestMethod[] = [
  "gateway.status", "security.audit",
  "chat.send", "chat.history",
  "sessions.list", "sessions.create",
  "agents.list", "agents.get", "agents.create", "agents.update", "agents.delete",
  "agents.bootstrap.get", "agents.bootstrap.set",
  "cron.list", "cron.create", "cron.update", "cron.delete", "cron.run", "cron.history",
  "config.get", "config.set",
  "usage.summary", "usage.by-session", "usage.by-model", "usage.timeseries",
  "agent.run", "agent.stream",
];

// ── History entry ─────────────────────────────────────────────────────────────

interface HistoryItem {
  id: string;
  method: string;
  params: string;
  response: string;
  ok: boolean;
  ts: number;
}

// ── JSON syntax coloring (simple tokenizer) ───────────────────────────────────

function colorJson(json: string): string {
  const colors: Record<string, string> = {
    key:     "#4a9eff",
    string:  "#4caf50",
    bool:    "#ffa726",
    null:    "#5a5a7a",
    number:  "#29b6f6",
  };
  return json
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = colors.number;
      if (/^"/.test(match)) cls = match.endsWith(":") ? colors.key : colors.string;
      else if (/true|false/.test(match)) cls = colors.bool;
      else if (/null/.test(match)) cls = colors.null;
      return `<span style="color:${cls}">${match.replace(/</g, "&lt;")}</span>`;
    });
}

// ── DebugConsole ──────────────────────────────────────────────────────────────

const DebugConsole: Component = () => {
  const [method, setMethod] = createSignal<string>("gateway.status");
  const [params, setParams] = createSignal("{}");
  const [response, setResponse] = createSignal("");
  const [responseOk, setResponseOk] = createSignal(true);
  const [sending, setSending] = createSignal(false);
  const [history, setHistory] = createSignal<HistoryItem[]>([]);
  const [openHistory, setOpenHistory] = createSignal<string | null>(null);
  const [events, setEvents] = createSignal<Array<{ id: string; frame: EventFrame; ts: number }>>([]);
  const [suggestions, setSuggestions] = createSignal<RequestMethod[]>([]);

  // Event monitor — capture all gateway frames
  onMount(() => {
    const handlers = (["session:message", "session:created", "config:changed", "agent:delta", "log"] as const).map(name =>
      gateway.onEvent(name, (payload) => {
        const frame: EventFrame = { event: name, payload, seq: Date.now() };
        setEvents(prev => [...prev.slice(-99), { id: crypto.randomUUID(), frame, ts: Date.now() }]);
      })
    );
    onCleanup(() => handlers.forEach(unsub => unsub()));
  });

  const updateMethod = (val: string) => {
    setMethod(val);
    const q = val.toLowerCase();
    setSuggestions(q ? KNOWN_METHODS.filter(m => m.includes(q) && m !== val) : []);
  };

  const send = async () => {
    let parsedParams: Record<string, unknown> = {};
    try { parsedParams = JSON.parse(params()) as Record<string, unknown>; }
    catch { setResponse("Invalid JSON in params."); setResponseOk(false); return; }

    setSending(true);
    const id = crypto.randomUUID();
    const ts = Date.now();
    try {
      const result = await gateway.request(method() as RequestMethod, parsedParams);
      const pretty = JSON.stringify(result, null, 2);
      setResponse(pretty); setResponseOk(true);
      setHistory(h => [{ id, method: method(), params: params(), response: pretty, ok: true, ts }, ...h.slice(0, 49)]);
    } catch (err) {
      const msg = (err as Error).message;
      setResponse(msg); setResponseOk(false);
      setHistory(h => [{ id, method: method(), params: params(), response: msg, ok: false, ts }, ...h.slice(0, 49)]);
    } finally { setSending(false); }
  };

  return (
    <div style={{ height: "100%", display: "flex", gap: t.space.md, padding: t.space.md, overflow: "hidden" }}>

      {/* ── Left: RPC Inspector ── */}
      <div style={{ flex: "1", display: "flex", "flex-direction": "column", gap: t.space.sm, "min-width": "0" }}>
        <div style={{ "font-size": t.font.sizeMd, "font-weight": t.font.weightBold, color: t.color.text }}>RPC Inspector</div>

        {/* Method input */}
        <div style={{ position: "relative" }}>
          <input
            type="text" value={method()} placeholder="Method name…"
            onInput={(e) => updateMethod(e.currentTarget.value)}
            style={{ width: "100%", background: t.color.bgCard, border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, color: t.color.text, "font-family": t.font.familyMono, "font-size": t.font.sizeSm, padding: "6px 10px", outline: "none", "box-sizing": "border-box" }}
          />
          <Show when={suggestions().length > 0}>
            <div style={{ position: "absolute", top: "100%", left: "0", right: "0", background: t.color.bgCard, border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, "box-shadow": t.shadow.md, "z-index": "50", overflow: "hidden" }}>
              <For each={suggestions().slice(0, 8)}>
                {(s) => (
                  <div onClick={() => { setMethod(s); setSuggestions([]); }}
                    style={{ padding: "5px 10px", "font-family": t.font.familyMono, "font-size": t.font.sizeSm, color: t.color.textMuted, cursor: "pointer", transition: `background ${t.transition.fast}` }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.bgHover; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                    {s}
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Params */}
        <textarea
          value={params()} rows={5} placeholder='{"key": "value"}'
          onInput={(e) => setParams(e.currentTarget.value)}
          style={{ resize: "vertical", background: t.color.bgCard, border: `1px solid ${t.color.border}`, "border-radius": t.radius.md, color: t.color.text, "font-family": t.font.familyMono, "font-size": t.font.sizeSm, padding: "6px 10px", outline: "none" }}
        />

        <Button onClick={send} loading={sending()} style={{ "align-self": "flex-start" }}>Send</Button>

        {/* Response */}
        <div style={{ flex: "1", background: t.color.bgCard, border: `1px solid ${responseOk() ? t.color.border : t.color.error}`, "border-radius": t.radius.md, overflow: "auto", padding: t.space.sm }}>
          <Show when={response()} fallback={<span style={{ color: t.color.textDim, "font-size": t.font.sizeSm }}>Response will appear here…</span>}>
            <pre style={{ margin: "0", "font-family": t.font.familyMono, "font-size": t.font.sizeSm, "white-space": "pre-wrap", "word-break": "break-word", color: responseOk() ? t.color.text : t.color.error }} innerHTML={responseOk() ? colorJson(response()) : undefined}>
              <Show when={!responseOk()}>{response()}</Show>
            </pre>
          </Show>
        </div>

        {/* History */}
        <Show when={history().length > 0}>
          <div style={{ "font-size": t.font.sizeSm, color: t.color.textMuted, "font-weight": t.font.weightBold, "text-transform": "uppercase", "letter-spacing": "0.05em" }}>History</div>
          <div style={{ "max-height": "160px", overflow: "auto", display: "flex", "flex-direction": "column", gap: "2px" }}>
            <For each={history()}>
              {(item) => (
                <div onClick={() => setOpenHistory(openHistory() === item.id ? null : item.id)}
                  style={{ cursor: "pointer", padding: "4px 8px", "border-radius": t.radius.sm, background: openHistory() === item.id ? t.color.bgHover : "transparent", "font-family": t.font.familyMono, "font-size": "11px", display: "flex", "align-items": "center", gap: t.space.sm }}>
                  <span style={{ color: item.ok ? t.color.success : t.color.error }}>●</span>
                  <span style={{ color: t.color.textMuted, flex: "1" }}>{item.method}</span>
                  <span style={{ color: t.color.textDim }}>{new Date(item.ts).toLocaleTimeString()}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* ── Right: Event Monitor ── */}
      <div style={{ width: "320px", "flex-shrink": "0", display: "flex", "flex-direction": "column", gap: t.space.sm, "border-left": `1px solid ${t.color.border}`, "padding-left": t.space.md }}>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
          <span style={{ "font-size": t.font.sizeMd, "font-weight": t.font.weightBold, color: t.color.text }}>Events</span>
          <button onClick={() => setEvents([])} style={{ background: "transparent", border: "none", color: t.color.textDim, cursor: "pointer", "font-size": t.font.sizeSm }}>Clear</button>
        </div>
        <div style={{ flex: "1", overflow: "auto", display: "flex", "flex-direction": "column", gap: "4px" }}>
          <Show when={events().length === 0}>
            <span style={{ color: t.color.textDim, "font-size": t.font.sizeSm }}>Listening for gateway events…</span>
          </Show>
          <For each={events().slice().reverse()}>
            {(e) => (
              <div style={{ background: t.color.bgCard, "border-radius": t.radius.sm, padding: "5px 8px", "font-family": t.font.familyMono, "font-size": "11px" }}>
                <div style={{ display: "flex", "align-items": "center", gap: t.space.xs }}>
                  <span style={{ color: t.color.accent, "font-weight": t.font.weightBold }}>{e.frame.event}</span>
                  <span style={{ color: t.color.textDim, "margin-left": "auto" }}>{new Date(e.ts).toLocaleTimeString()}</span>
                </div>
                <div style={{ color: t.color.textMuted, "margin-top": "2px", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                  {JSON.stringify(e.frame.payload).slice(0, 80)}
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export default DebugConsole;
