import { createSignal } from "solid-js";
import { setStore } from "../stores/app";
import { connectAndAuthenticate } from "../stores/actions";

const DEFAULT_URL = "ws://localhost:18789/ws";

export default function LoginPrompt() {
  const [url,     setUrl]     = createSignal(DEFAULT_URL);
  const [token,   setToken]   = createSignal("");
  const [error,   setError]   = createSignal("");
  const [loading, setLoading] = createSignal(false);

  async function handleConnect(e: Event) {
    e.preventDefault();
    if (!url().trim() || !token().trim()) {
      setError("Gateway URL and token are required.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      await connectAndAuthenticate(url().trim(), token().trim());

      // Persist credentials
      localStorage.setItem("nexus_gateway_url",   url().trim());
      localStorage.setItem("nexus_gateway_token", token().trim());

      // Connection is already established by connectAndAuthenticate
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection failed.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      height: "100%",
      padding: "24px",
    }}>
      <div class="card" style={{ width: "100%", "max-width": "400px" }}>
        {/* Logo / heading */}
        <div style={{ "text-align": "center", "margin-bottom": "24px" }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"
               width="40" height="40" style={{ display: "inline-block" }}>
            <circle cx="16" cy="16" r="15" fill="#252542"
                    stroke="#4a9eff" stroke-width="1.5"/>
            <text x="16" y="21"
                  font-family="-apple-system, sans-serif"
                  font-size="16" font-weight="700"
                  fill="#4a9eff" text-anchor="middle">N</text>
          </svg>
          <h1 style={{
            "margin-top": "12px",
            "font-size": "20px",
            "font-weight": "600",
            color: "var(--text)",
          }}>
            Connect to Nexus
          </h1>
          <p style={{ color: "#8888aa", "font-size": "13px", "margin-top": "4px" }}>
            Enter your gateway address and token to begin.
          </p>
        </div>

        <form onSubmit={handleConnect}
              style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
          <label style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <span style={{ "font-size": "12px", color: "#8888aa", "text-transform": "uppercase", "letter-spacing": "0.05em" }}>
              Gateway URL
            </span>
            <input
              type="text"
              value={url()}
              onInput={(e) => setUrl(e.currentTarget.value)}
              placeholder={DEFAULT_URL}
              autocomplete="off"
              spellcheck={false}
              style={{ width: "100%" }}
            />
          </label>

          <label style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <span style={{ "font-size": "12px", color: "#8888aa", "text-transform": "uppercase", "letter-spacing": "0.05em" }}>
              Token
            </span>
            <input
              type="password"
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
              placeholder="••••••••••••"
              autocomplete="current-password"
              style={{ width: "100%" }}
            />
          </label>

          {error() && (
            <p style={{
              color: "var(--error)",
              "font-size": "13px",
              padding: "8px 10px",
              background: "rgba(244,67,54,0.1)",
              border: "1px solid rgba(244,67,54,0.3)",
              "border-radius": "4px",
            }}>
              {error()}
            </p>
          )}

          <button
            type="submit"
            disabled={loading()}
            style={{ "margin-top": "4px", width: "100%", padding: "9px 14px" }}
          >
            {loading() ? "Connecting…" : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
}
