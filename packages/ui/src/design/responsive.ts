// Responsive design utilities — breakpoints, media queries, and style mixins.

import type { JSX } from "solid-js";
import { tokens as t } from "./tokens";

// ── Breakpoints ──────────────────────────────────────────────────────────────

export const breakpoints = {
  mobile: 480,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
} as const;

// ── Media query strings ──────────────────────────────────────────────────────

export const media = {
  mobile:  `@media (max-width: ${breakpoints.mobile}px)`,
  tablet:  `@media (max-width: ${breakpoints.tablet}px)`,
  desktop: `@media (min-width: ${breakpoints.desktop}px)`,
  wide:    `@media (min-width: ${breakpoints.wide}px)`,
} as const;

// ── CSS class strings for injection via <style> tags ─────────────────────────
// SolidJS inline styles cannot express media queries, so we provide CSS class
// strings that components inject via a <style> block and then reference
// class names.

export const responsiveCss = `
  /* Sidebar: hide on mobile, overlay on tablet */
  ${media.tablet} {
    .nx-sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 100;
      transform: translateX(-100%); transition: transform 0.25s ease; }
    .nx-sidebar--open { transform: translateX(0); }
    .nx-sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      z-index: 99; }
    .nx-hamburger { display: flex !important; }
    .nx-main { margin-left: 0 !important; }
  }

  ${media.desktop} {
    .nx-sidebar { position: relative; transform: none; }
    .nx-sidebar-overlay { display: none; }
    .nx-hamburger { display: none !important; }
  }

  /* Chat input: larger touch targets on mobile */
  ${media.mobile} {
    .nx-chat-input textarea { font-size: 16px !important; min-height: 40px !important; }
    .nx-chat-input button { padding: 10px 18px !important; font-size: 15px !important; }
    .nx-message-bubble { max-width: 90% !important; padding: 8px 10px !important; }
    .nx-tab-bar { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  }

  /* Message bubbles: less padding on mobile */
  ${media.tablet} {
    .nx-message-bubble { max-width: 85% !important; }
    .nx-message-row { margin: 4px 8px !important; }
  }
`;

// ── Hamburger button style (inline) ──────────────────────────────────────────

export const hamburgerStyle: JSX.CSSProperties = {
  display: "none",
  "align-items": "center",
  "justify-content": "center",
  width: "36px",
  height: "36px",
  background: "transparent",
  border: `1px solid ${t.color.border}`,
  "border-radius": t.radius.md,
  color: t.color.textMuted,
  cursor: "pointer",
  "font-size": "18px",
  "flex-shrink": "0",
  "z-index": "101",
};
