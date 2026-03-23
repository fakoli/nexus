import { createEffect, Match, Switch, onMount, onCleanup } from "solid-js";
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

// ── Root App ───────────────────────────────────────────────────────────────
export default function App() {
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
              <div class="placeholder-view">
                <span class="placeholder-icon">⬡</span>
                <h2>Agents</h2>
                <p>Agent management coming soon.</p>
              </div>
            </Match>
            <Match when={store.ui.tab === "cron"}>
              <div class="placeholder-view">
                <span class="placeholder-icon">◷</span>
                <h2>Cron Jobs</h2>
                <p>Scheduled task management coming soon.</p>
              </div>
            </Match>
            <Match when={store.ui.tab === "analytics"}>
              <div class="placeholder-view">
                <span class="placeholder-icon">↗</span>
                <h2>Analytics</h2>
                <p>Usage statistics and insights coming soon.</p>
              </div>
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
