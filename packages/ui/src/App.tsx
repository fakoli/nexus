import { createEffect, createSignal, Match, Switch, onMount, onCleanup, Show } from "solid-js";
import { store, setStore } from "./stores/app";
import { initGateway } from "./stores/actions";
import { DEFAULT_GATEWAY_URL } from "./constants";
import Sidebar from "./components/layout/Sidebar";
import CommandPalette from "./components/layout/CommandPalette";
import StatusBar from "./components/shared/StatusBar";
import ChatView from "./components/chat/ChatView";
import SessionList from "./components/sessions/SessionList";
import ConfigPanel from "./components/config/ConfigPanel";
import LoginPrompt from "./components/LoginPrompt";
import Toast from "./components/shared/Toast";
import AgentList from "./components/agents/AgentList";
import AgentEditor from "./components/agents/AgentEditor";
import BootstrapEditor from "./components/agents/BootstrapEditor";
import { UsageDashboard } from "./components/analytics/UsageDashboard";
import CronList from "./components/cron/CronList";
import PluginManager from "./components/plugins/PluginManager";
import Dashboard from "./components/overview/Dashboard";
import LogViewer from "./components/debug/LogViewer";
import DebugConsole from "./components/debug/DebugConsole";

// ── Root App ───────────────────────────────────────────────────────────────
export default function App() {
  const [selectedAgentId, setSelectedAgentId] = createSignal("");
  const [showBootstrap, setShowBootstrap] = createSignal(false);
  // Initialise gateway connection once on mount when credentials are present.
  onMount(() => {
    const savedUrl   = localStorage.getItem("nexus_gateway_url");
    const savedToken = localStorage.getItem("nexus_gateway_token");

    setStore("ui", "gatewayUrl", savedUrl ?? DEFAULT_GATEWAY_URL);
    if (savedToken) setStore("ui", "token", savedToken);

    // Global Cmd+K / Ctrl+K listener for command palette
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setStore("ui", "commandPaletteOpen", !store.ui.commandPaletteOpen);
      }
    };
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  // Re-connect whenever the token changes (covers first-time login too).
  createEffect(() => {
    const { token, gatewayUrl } = store.ui;
    if (token && gatewayUrl) initGateway(gatewayUrl, token);
  });

  const hasCredentials = () => Boolean(store.ui.token && store.ui.gatewayUrl);

  return (
    <div id="app">
      <Sidebar />

      <div class="app-main">
        <div class="app-status">
          <StatusBar />
        </div>

        <div class="app-content">
          <Switch>
            <Match when={!hasCredentials()}>
              <LoginPrompt />
            </Match>
            <Match when={store.ui.tab === "overview"}>
              <Dashboard />
            </Match>
            <Match when={store.ui.tab === "logs"}>
              <LogViewer />
            </Match>
            <Match when={store.ui.tab === "debug"}>
              <DebugConsole />
            </Match>
            <Match when={store.ui.tab === "chat"}>
              <ChatView />
            </Match>
            <Match when={store.ui.tab === "sessions"}>
              <SessionList />
            </Match>
            <Match when={store.ui.tab === "config"}>
              <ConfigPanel />
            </Match>
            <Match when={store.ui.tab === "agents"}>
              <Show when={showBootstrap() && selectedAgentId()} fallback={
                <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
                  <div style={{ width: "340px", "flex-shrink": "0", "border-right": "1px solid #3a3a5c", overflow: "hidden" }}>
                    <AgentList selectedId={selectedAgentId()} onSelect={setSelectedAgentId} />
                  </div>
                  <div style={{ flex: "1", overflow: "hidden" }}>
                    <AgentEditor agentId={selectedAgentId()} onOpenBootstrap={() => setShowBootstrap(true)} />
                  </div>
                </div>
              }>
                <BootstrapEditor agentId={selectedAgentId()} onClose={() => setShowBootstrap(false)} />
              </Show>
            </Match>
            <Match when={store.ui.tab === "cron"}>
              <CronList />
            </Match>
            <Match when={store.ui.tab === "plugins"}>
              <PluginManager />
            </Match>
            <Match when={store.ui.tab === "analytics"}>
              <UsageDashboard />
            </Match>
          </Switch>
        </div>
      </div>

      <CommandPalette
        open={store.ui.commandPaletteOpen}
        onClose={() => setStore("ui", "commandPaletteOpen", false)}
      />

      <Toast />
    </div>
  );
}
