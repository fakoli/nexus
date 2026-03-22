/**
 * Tests for the markdown-to-HTML renderer (packages/ui/src/utils/markdown.ts).
 */
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../utils/markdown";

// ── Bold ──────────────────────────────────────────────────────────────────────

describe("bold rendering", () => {
  it("wraps **text** in <strong>", () => {
    expect(renderMarkdown("**hello**")).toBe("<strong>hello</strong>");
  });

  it("handles multiple bold spans on one line", () => {
    const result = renderMarkdown("**foo** and **bar**");
    expect(result).toBe("<strong>foo</strong> and <strong>bar</strong>");
  });

  it("bold does not interfere with surrounding plain text", () => {
    const result = renderMarkdown("before **bold** after");
    expect(result).toBe("before <strong>bold</strong> after");
  });

  it("single asterisk is not treated as bold", () => {
    const result = renderMarkdown("*not bold*");
    expect(result).not.toContain("<strong>");
    expect(result).toContain("*not bold*");
  });
});

// ── Inline code ───────────────────────────────────────────────────────────────

describe("inline code rendering", () => {
  it("wraps `code` in <code>", () => {
    expect(renderMarkdown("`hello`")).toBe("<code>hello</code>");
  });

  it("escapes HTML inside inline code", () => {
    const result = renderMarkdown("`<script>`");
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("inline code does not render bold markers inside it", () => {
    const result = renderMarkdown("`**not bold**`");
    expect(result).toContain("<code>");
    expect(result).not.toContain("<strong>");
  });
});

// ── Fenced code blocks ────────────────────────────────────────────────────────

describe("fenced code block rendering", () => {
  it("renders ``` block as <pre><code>", () => {
    const md = "```\nconsole.log('hi');\n```";
    const result = renderMarkdown(md);
    expect(result).toContain("<pre><code>");
    expect(result).toContain("console.log");
    expect(result).toContain("</code></pre>");
  });

  it("attaches language class when language is specified", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const result = renderMarkdown(md);
    expect(result).toContain('class="language-typescript"');
  });

  it("escapes HTML inside code blocks", () => {
    const md = "```\n<div>test</div>\n```";
    const result = renderMarkdown(md);
    expect(result).toContain("&lt;div&gt;");
    expect(result).not.toContain("<div>");
  });

  it("does not render bold markers inside a code block", () => {
    const md = "```\n**not bold**\n```";
    const result = renderMarkdown(md);
    expect(result).not.toContain("<strong>");
    expect(result).toContain("**not bold**");
  });
});

// ── Links ─────────────────────────────────────────────────────────────────────

describe("link conversion", () => {
  it("converts [text](url) to an <a> tag", () => {
    const result = renderMarkdown("[OpenAI](https://openai.com)");
    expect(result).toContain('<a href="https://openai.com"');
    expect(result).toContain("OpenAI");
    expect(result).toContain("</a>");
  });

  it("adds target=_blank and rel=noopener noreferrer", () => {
    const result = renderMarkdown("[x](https://x.com)");
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("escapes special characters in link URLs", () => {
    const result = renderMarkdown('[q](https://example.com?a=1&b=2)');
    // & should be escaped to &amp; in the href attribute
    expect(result).toContain("a=1&amp;b=2");
    // Verify no double-escape (&amp;amp;)
    expect(result).not.toContain("&amp;amp;");
  });

  it("handles multiple links in one string", () => {
    const result = renderMarkdown("[A](https://a.com) and [B](https://b.com)");
    expect(result).toContain('href="https://a.com"');
    expect(result).toContain('href="https://b.com"');
  });
});

// ── HTML escaping / XSS prevention ───────────────────────────────────────────

describe("HTML escaping (XSS prevention)", () => {
  it("escapes < and > in plain text", () => {
    const result = renderMarkdown("<script>alert(1)</script>");
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("escapes & in plain text", () => {
    const result = renderMarkdown("a & b");
    expect(result).toContain("&amp;");
  });

  it("escapes \" in plain text", () => {
    const result = renderMarkdown('say "hello"');
    expect(result).toContain("&quot;");
  });

  it("does not double-escape entities inside code blocks", () => {
    const md = "```\na & b\n```";
    const result = renderMarkdown(md);
    // Should be escaped once as &amp;, not &amp;amp;
    expect(result).toContain("&amp;");
    expect(result).not.toContain("&amp;amp;");
  });

  it("XSS payload in link text is escaped", () => {
    const result = renderMarkdown('[<img src=x onerror=alert(1)>](https://safe.com)');
    expect(result).not.toContain("<img");
  });
});

// ── Newlines ──────────────────────────────────────────────────────────────────

describe("newline handling", () => {
  it("converts single newline to <br>", () => {
    const result = renderMarkdown("line1\nline2");
    expect(result).toContain("<br>");
  });

  it("multiple newlines produce multiple <br>", () => {
    const result = renderMarkdown("a\n\nb");
    expect(result.match(/<br>/g)?.length).toBe(2);
  });
});

// ── Combined / integration ────────────────────────────────────────────────────

describe("combined markdown rendering", () => {
  it("renders bold and inline code together", () => {
    const result = renderMarkdown("Use **`const`** for constants");
    expect(result).toContain("<strong>");
    expect(result).toContain("<code>const</code>");
  });

  it("renders a realistic message with multiple elements", () => {
    const md = [
      "Here is some **bold text** and a `snippet`.",
      "Visit [docs](https://docs.example.com) for details.",
    ].join("\n");
    const result = renderMarkdown(md);
    expect(result).toContain("<strong>bold text</strong>");
    expect(result).toContain("<code>snippet</code>");
    expect(result).toContain('<a href="https://docs.example.com"');
    expect(result).toContain("<br>");
  });

  it("handles empty string input without throwing", () => {
    expect(() => renderMarkdown("")).not.toThrow();
    expect(renderMarkdown("")).toBe("");
  });

  it("returns plain text unchanged when no markdown is present", () => {
    const plain = "hello world, no markdown here";
    expect(renderMarkdown(plain)).toBe(plain);
  });

  it("renders a code block followed by inline text correctly", () => {
    const md = "```js\nconsole.log(1);\n```\nEnd of block.";
    const result = renderMarkdown(md);
    expect(result).toContain("<pre><code");
    expect(result).toContain("End of block.");
    // The code block should not have a <br> injected inside it
    const preContent = result.match(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/)?.[1] ?? "";
    expect(preContent).not.toContain("<br>");
  });
});
