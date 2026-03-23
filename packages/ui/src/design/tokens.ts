// Design tokens — single source of truth for all visual decisions.
// Import `tokens` and use inline styles; no external CSS framework required.

export const tokens = {
  // ── Colors ──────────────────────────────────────────────────────────────────
  color: {
    bg:         "#1a1a2e",
    bgCard:     "#252542",
    bgHover:    "#2e2e50",
    bgSidebar:  "#13132a",
    bgInput:    "#1a1a2e",
    bgOverlay:  "rgba(10, 10, 20, 0.85)",

    text:       "#e0e0e0",
    textMuted:  "#8888aa",
    textDim:    "#5a5a7a",

    accent:     "#4a9eff",
    accentDim:  "#2a6eb0",

    success:    "#4caf50",
    warning:    "#ffa726",
    error:      "#f44336",
    info:       "#29b6f6",

    border:     "#3a3a5c",
    borderFocus:"#4a9eff",
    borderHover:"#4a4a6c",
  },

  // ── Spacing ──────────────────────────────────────────────────────────────────
  space: {
    xs:  "4px",
    sm:  "8px",
    md:  "16px",
    lg:  "24px",
    xl:  "32px",
    xxl: "48px",
  },

  // ── Typography ────────────────────────────────────────────────────────────────
  font: {
    family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    familyMono: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",

    sizeSm:  "11px",
    sizeMd:  "13px",
    sizeLg:  "15px",
    sizeXl:  "18px",

    weightNormal: "400",
    weightMedium: "500",
    weightBold:   "600",

    lineHeight: "1.5",
  },

  // ── Shadows ───────────────────────────────────────────────────────────────────
  shadow: {
    sm:  "0 1px 3px rgba(0,0,0,0.4)",
    md:  "0 4px 12px rgba(0,0,0,0.5)",
    lg:  "0 8px 24px rgba(0,0,0,0.6)",
    xl:  "0 16px 48px rgba(0,0,0,0.7)",
  },

  // ── Border radii ──────────────────────────────────────────────────────────────
  radius: {
    sm:   "4px",
    md:   "6px",
    lg:   "10px",
    xl:   "14px",
    full: "9999px",
  },

  // ── Transitions ───────────────────────────────────────────────────────────────
  transition: {
    fast:   "0.1s ease",
    normal: "0.15s ease",
    slow:   "0.25s ease",
  },

  // ── Sidebar dimensions ────────────────────────────────────────────────────────
  sidebar: {
    collapsed: "48px",
    expanded:  "200px",
  },
} as const;

export type Tokens = typeof tokens;
