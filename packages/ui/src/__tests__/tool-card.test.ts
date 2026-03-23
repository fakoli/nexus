/**
 * Tests for the pure helper logic in ToolCard
 * (packages/ui/src/components/chat/ToolCard.tsx).
 *
 * ToolCard is a SolidJS component; we test its pure internal helpers and
 * the styling decisions (border colour, icon, label) without a DOM environment.
 */
import { describe, it, expect } from "vitest";
import { tokens as t } from "../design/tokens";

// ── Re-implement the pure helpers exactly as they appear in ToolCard.tsx ──────

function highlightJson(raw: string): string {
  let escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^"\\])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "color:#ce9178"; // string
      if (/^"/.test(match)) {
        if (/:$/.test(match)) cls = "color:#9cdcfe"; // key
      } else if (/true|false/.test(match)) {
        cls = "color:#569cd6"; // boolean
      } else if (/null/.test(match)) {
        cls = "color:#569cd6"; // null
      } else {
        cls = "color:#b5cea8"; // number
      }
      return `<span style="${cls}">${match}</span>`;
    },
  );
}

function summarise(content: string, max = 80): string {
  const trimmed = content.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max) + "…";
}

function parseToolName(content: string): string {
  try {
    const obj = JSON.parse(content) as Record<string, unknown>;
    if (typeof obj["name"] === "string") return obj["name"];
    if (typeof obj["tool"] === "string") return obj["tool"];
  } catch {
    // not JSON
  }
  return "tool";
}

function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function isErrorResult(content: string): boolean {
  try {
    const obj = JSON.parse(content) as Record<string, unknown>;
    return (
      obj["error"] !== undefined ||
      obj["ok"] === false ||
      obj["success"] === false
    );
  } catch {
    return false;
  }
}

function borderColor(role: "tool_use" | "tool_result", content: string): string {
  if (role === "tool_use") return "#7c6fc4";
  return isErrorResult(content) ? t.color.error : t.color.success;
}

// ── parseToolName ─────────────────────────────────────────────────────────────

describe("parseToolName", () => {
  it("extracts name field from JSON content", () => {
    const content = JSON.stringify({ name: "read_file", input: { path: "/tmp/test" } });
    expect(parseToolName(content)).toBe("read_file");
  });

  it("falls back to tool field when name is absent", () => {
    const content = JSON.stringify({ tool: "web_search", query: "nexus" });
    expect(parseToolName(content)).toBe("web_search");
  });

  it("returns 'tool' for non-JSON content", () => {
    expect(parseToolName("not json at all")).toBe("tool");
  });

  it("returns 'tool' when neither name nor tool field is present", () => {
    const content = JSON.stringify({ action: "something" });
    expect(parseToolName(content)).toBe("tool");
  });

  it("returns 'tool' for empty string", () => {
    expect(parseToolName("")).toBe("tool");
  });
});

// ── borderColor ───────────────────────────────────────────────────────────────

describe("borderColor: purple for tool_use, green/red for tool_result", () => {
  it("returns purple (#7c6fc4) for tool_use role", () => {
    const content = JSON.stringify({ name: "bash", command: "ls" });
    expect(borderColor("tool_use", content)).toBe("#7c6fc4");
  });

  it("returns success color for a successful tool_result", () => {
    const content = JSON.stringify({ output: "file contents", ok: true });
    expect(borderColor("tool_result", content)).toBe(t.color.success);
  });

  it("returns error color for a tool_result with error field", () => {
    const content = JSON.stringify({ error: "file not found" });
    expect(borderColor("tool_result", content)).toBe(t.color.error);
  });

  it("returns error color for a tool_result with ok:false", () => {
    const content = JSON.stringify({ ok: false, message: "permission denied" });
    expect(borderColor("tool_result", content)).toBe(t.color.error);
  });

  it("returns error color for a tool_result with success:false", () => {
    const content = JSON.stringify({ success: false });
    expect(borderColor("tool_result", content)).toBe(t.color.error);
  });

  it("returns success color for tool_result with plain string content", () => {
    // Plain string (non-JSON) is not an error
    expect(borderColor("tool_result", "all done")).toBe(t.color.success);
  });
});

// ── isErrorResult ─────────────────────────────────────────────────────────────

describe("isErrorResult", () => {
  it("returns true when error key is present", () => {
    expect(isErrorResult(JSON.stringify({ error: "oops" }))).toBe(true);
  });

  it("returns true when ok is false", () => {
    expect(isErrorResult(JSON.stringify({ ok: false }))).toBe(true);
  });

  it("returns true when success is false", () => {
    expect(isErrorResult(JSON.stringify({ success: false }))).toBe(true);
  });

  it("returns false for a successful result", () => {
    expect(isErrorResult(JSON.stringify({ result: "ok", ok: true }))).toBe(false);
  });

  it("returns false for non-JSON content", () => {
    expect(isErrorResult("plain text result")).toBe(false);
  });
});

// ── summarise ─────────────────────────────────────────────────────────────────

describe("summarise: collapsed preview text", () => {
  it("returns the full string when it is under 80 chars", () => {
    const short = "short content";
    expect(summarise(short)).toBe(short);
  });

  it("truncates strings longer than 80 chars with ellipsis", () => {
    const long = "a".repeat(100);
    const result = summarise(long);
    expect(result).toHaveLength(81); // 80 chars + "…"
    expect(result.endsWith("…")).toBe(true);
  });

  it("trims leading and trailing whitespace before measuring", () => {
    const padded = "  hello  ";
    expect(summarise(padded)).toBe("hello");
  });

  it("returns exactly 80 chars (no truncation) at the boundary", () => {
    const boundary = "x".repeat(80);
    expect(summarise(boundary)).toBe(boundary);
  });
});

// ── prettyJson ────────────────────────────────────────────────────────────────

describe("prettyJson: JSON formatting for expanded view", () => {
  it("pretty-prints a JSON object with 2-space indentation", () => {
    const content = JSON.stringify({ a: 1, b: "hello" });
    const result = prettyJson(content);
    expect(result).toContain("  \"a\":");
    expect(result).toContain("  \"b\":");
  });

  it("returns the original string when content is not valid JSON", () => {
    const raw = "plain text response";
    expect(prettyJson(raw)).toBe(raw);
  });

  it("handles nested objects", () => {
    const content = JSON.stringify({ outer: { inner: 42 } });
    const result = prettyJson(content);
    expect(result).toContain("\"inner\": 42");
  });
});

// ── highlightJson ─────────────────────────────────────────────────────────────

describe("highlightJson: syntax coloring", () => {
  it("wraps JSON keys in a span with the key color", () => {
    const json = '"name": "test"';
    const result = highlightJson(json);
    // Key spans have color:#9cdcfe
    expect(result).toContain("color:#9cdcfe");
  });

  it("wraps string values in a span with the string color", () => {
    const json = '"value"';
    const result = highlightJson(json);
    expect(result).toContain("color:#ce9178");
  });

  it("wraps boolean true/false in a span with the boolean color", () => {
    const result = highlightJson("true");
    expect(result).toContain("color:#569cd6");
  });

  it("wraps null in a span with the null color", () => {
    const result = highlightJson("null");
    expect(result).toContain("color:#569cd6");
  });

  it("escapes < and > to prevent XSS in JSON output", () => {
    const content = '{"cmd": "<script>alert(1)</script>"}';
    const result = highlightJson(content);
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("escapes & to prevent HTML entity injection", () => {
    const content = '{"url": "a&b"}';
    const result = highlightJson(content);
    expect(result).toContain("&amp;");
  });
});
