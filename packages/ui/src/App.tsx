import { createEffect, Match, Switch, onMount } from "solid-js";
import { store, setStore } from "./stores/app";
import { initGateway } from "./stores/actions";
import TabBar from "./components/shared/TabBar";
import StatusBar from "./components/shared/StatusBar";
import ChatView from "./components/chat/ChatView";
import SessionList from "./components/sessions/SessionList";
import ConfigEditor from "./components/config/ConfigEditor";
import LoginPrompt from "./components/LoginPrompt";

// ── Logs placeholder ───────────────────────────────────────────────────────
function LogsView() {
  return (
    <div style={{ padding: "24px", color: "var(--text)", opacity: "0.6" }}>
      Logs view — coming soon.
    </div>
  );
}

// ── Root App ───────────────────────────────────────────────────────────────
export default function App() {
  // Initialise gateway connection once on mount when credentials are present.
  onMount(() => {
    const url   = localStorage.getItem("nexus_gateway_url");
    const token = localStorage.getItem("nexus_gateway_token");

    if (url && token) {
      setStore("ui", "gatewayUrl", url);
      setStore("ui", "token", token);
    }
  });

  // Re-connect whenever the token changes (covers first-time login too).
  createEffect(() => {
    const { token, gatewayUrl } = store.ui;
    if (token && gatewayUrl) {
      initGateway(gatewayUrl, token);
    }
  });

  const hasCredentials = () =>
    Boolean(store.ui.token && store.ui.gatewayUrl);

  return (
    <div id="app">
      <nav class="app-sidebar">
        <TabBar />
      </nav>

      <div class="app-main">
        <div class="app-status">
          <StatusBar />
        </div>

        <div class="app-content">
          <Switch>
            {/* No credentials yet — show login */}
            <Match when={!hasCredentials()}>
              <LoginPrompt />
            </Match>

            {/* Tabbed views */}
            <Match when={store.ui.tab === "chat"}>
              <ChatView />
            </Match>
            <Match when={store.ui.tab === "sessions"}>
              <SessionList />
            </Match>
            <Match when={store.ui.tab === "config"}>
              <ConfigEditor />
            </Match>
            <Match when={store.ui.tab === "logs"}>
              <LogsView />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}
