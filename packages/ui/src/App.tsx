import { createEffect, lazy, Match, Switch, onMount, onCleanup, Show, Suspense } from "solid-js";
import { store, setStore } from "./stores/app";
import { initGateway } from "./stores/actions";
import { DEFAULT_GATEWAY_URL } from "./constants";
import Sidebar from "./components/layout/Sidebar";
import CommandPalette from "./components/layout/CommandPalette";
import StatusBar from "./components/shared/StatusBar";
import ChatView from "./components/chat/ChatView";
import LoginPrompt from "./components/LoginPrompt";
import Toast from "./components/shared/Toast";
import Dashboard from "./components/overview/Dashboard";
import { SafePanel } from "./components/ErrorFallback";
import { Skeleton } from "./components/LoadingState";
import { responsiveCss } from "./design/responsive";

// ── Lazy-loaded views (code splitting) ────────────────────────────────────────
const SessionList    = lazy(() => import("./components/sessions/SessionList"));
const ConfigPanel    = lazy(() => import("./components/config/ConfigPanel"));
const AgentList      = lazy(() => import("./components/agents/AgentList"));
const AgentEditor    = lazy(() => import("./components/agents/AgentEditor"));
const BootstrapEditor= lazy(() => import("./components/agents/BootstrapEditor"));
const UsageDashboard = lazy(() => import("./components/analytics/UsageDashboard").then((m) => ({ default: m.UsageDashboard })));
const CronList       = lazy(() => import("./components/cron/CronList"));
const PluginManager  = lazy(() => import("./components/plugins/PluginManager"));
const LogViewer      = lazy(() => import("./components/debug/LogViewer"));
const DebugConsole   = lazy(() => import("./components/debug/DebugConsole"));
const FederationView = lazy(() => import("./components/views/FederationView"));
const SkillsView     = lazy(() => import("./components/views/SkillsView"));

// ── Root App ───────────────────────────────────────────────────────────────
import { createSignal } from "solid-js";

export default function App() {
  const [selectedAgentId, setSelectedAgentId] = createSignal("");
  const [showBootstrap, setShowBootstrap] = createSignal(false);

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

  createEffect(() => {
    const { token, gatewayUrl } = store.ui;
    if (token && gatewayUrl) initGateway(gatewayUrl, token);
  });

  const hasCredentials = () => Boolean(store.ui.token && store.ui.gatewayUrl);

  return (
    <div id="app">
      {/* Skip-to-content link for keyboard/screen reader users */}
      <a
        href="#main-content"
        style={{
          position: "absolute", top: "-40px", left: "0",
          background: "#4a9eff", color: "#fff",
          padding: "8px 16px", "z-index": "9999",
          "text-decoration": "none", "font-size": "13px",
          transition: "top 0.1s",
        }}
        onFocus={(e) => { (e.currentTarget as HTMLAnchorElement).style.top = "0"; }}
        onBlur={(e) => { (e.currentTarget as HTMLAnchorElement).style.top = "-40px"; }}
      >
        Skip to main content
      </a>

      <Sidebar />

      <div class="app-main">
        <div class="app-status">
          <StatusBar />
        </div>

        <main id="main-content" class="app-content">
          <Switch>
            <Match when={!hasCredentials()}>
              <SafePanel name="Login">
                <LoginPrompt />
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "overview"}>
              <SafePanel name="Dashboard">
                <Dashboard />
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "logs"}>
              <SafePanel name="Logs">
                <Suspense fallback={<Skeleton lines={6} />}>
                  <LogViewer />
                </Suspense>
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "debug"}>
              <SafePanel name="Debug">
                <Suspense fallback={<Skeleton lines={6} />}>
                  <DebugConsole />
                </Suspense>
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "chat"}>
              <SafePanel name="Chat">
                <ChatView />
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "sessions"}>
              <SafePanel name="Sessions">
                <Suspense fallback={<Skeleton lines={4} />}>
                  <SessionList />
                </Suspense>
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "config"}>
              <SafePanel name="Config">
                <Suspense fallback={<Skeleton lines={5} />}>
                  <ConfigPanel />
                </Suspense>
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "agents"}>
              <SafePanel name="Agents">
                <Show when={showBootstrap() && selectedAgentId()} fallback={
                  <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
                    <div style={{ width: "340px", "flex-shrink": "0", "border-right": "1px solid #3a3a5c", overflow: "hidden" }}>
                      <Suspense fallback={<Skeleton lines={4} />}>
                        <AgentList selectedId={selectedAgentId()} onSelect={setSelectedAgentId} />
                      </Suspense>
                    </div>
                    <div style={{ flex: "1", overflow: "hidden" }}>
                      <Suspense fallback={<Skeleton lines={6} />}>
                        <AgentEditor agentId={selectedAgentId()} onOpenBootstrap={() => setShowBootstrap(true)} />
                      </Suspense>
                    </div>
                  </div>
                }>
                  <Suspense fallback={<Skeleton lines={8} />}>
                    <BootstrapEditor agentId={selectedAgentId()} onClose={() => setShowBootstrap(false)} />
                  </Suspense>
                </Show>
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "cron"}>
              <SafePanel name="Cron">
                <Suspense fallback={<Skeleton lines={4} />}>
                  <CronList />
                </Suspense>
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "plugins"}>
              <SafePanel name="Plugins">
                <Suspense fallback={<Skeleton lines={4} />}>
                  <PluginManager />
                </Suspense>
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "analytics"}>
              <SafePanel name="Analytics">
                <Suspense fallback={<Skeleton lines={5} />}>
                  <UsageDashboard />
                </Suspense>
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "federation"}>
              <SafePanel name="Federation">
                <Suspense fallback={<Skeleton lines={4} />}>
                  <FederationView />
                </Suspense>
              </SafePanel>
            </Match>
            <Match when={store.ui.tab === "skills"}>
              <SafePanel name="Skills">
                <Suspense fallback={<Skeleton lines={4} />}>
                  <SkillsView />
                </Suspense>
              </SafePanel>
            </Match>
          </Switch>
        </main>
      </div>

      <CommandPalette
        open={store.ui.commandPaletteOpen}
        onClose={() => setStore("ui", "commandPaletteOpen", false)}
      />

      <Toast />
      <style>{responsiveCss}</style>
    </div>
  );
}
