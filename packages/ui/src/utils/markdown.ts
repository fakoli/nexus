/**
 * Lightweight markdown-to-HTML renderer.
 * Returns an HTML string safe for use with `innerHTML`.
 */

/** Escape raw text so it is safe to embed in HTML. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a subset of Markdown to HTML.
 *
 * Supported syntax (in order of processing):
 *   ``` fenced code blocks ```
 *   `inline code`
 *   **bold**
 *   [text](url) links
 *   \n  newlines → <br>
 */
export function renderMarkdown(input: string): string {
  // 1. Fenced code blocks  ```lang\n...\n```
  //    Process before everything else so inner content is not transformed.
  const blocks: string[] = [];
  let html = input.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const langAttr = lang.trim() ? ` class="language-${escapeHtml(lang.trim())}"` : "";
    const placeholder = `\x00BLOCK${blocks.length}\x00`;
    blocks.push(`<pre><code${langAttr}>${escapeHtml(code)}</code></pre>`);
    return placeholder;
  });

  // 2. Inline code  `code`
  const inlines: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    const placeholder = `\x00INLINE${inlines.length}\x00`;
    inlines.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // 3. Escape remaining HTML in the non-code portions
  html = html.replace(/[&<>"]/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default:  return ch;
    }
  });

  // 4. Bold  **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // 5. Links  [text](url)
  //    URL is already HTML-escaped from step 3, so no double-escape needed.
  //    Only allow http(s) and mailto schemes to prevent javascript: XSS.
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    // Decode &amp; back to & for the scheme check, then re-check the raw scheme.
    // The url here has been HTML-escaped in step 3; extract the scheme from the
    // original by checking the escaped form (e.g. "javascript:" has no HTML
    // chars so it passes through step 3 unchanged).
    const rawScheme = url.split(":")[0].toLowerCase();
    if (rawScheme !== "http" && rawScheme !== "https" && rawScheme !== "mailto") {
      // Render the link text as plain text instead of an anchor
      return text;
    }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // 6. Newlines → <br>
  html = html.replace(/\n/g, "<br>");

  // 7. Restore inline code placeholders
  html = html.replace(/\x00INLINE(\d+)\x00/g, (_m, i) => inlines[Number(i)]);

  // 8. Restore block code placeholders (strip surrounding <br> if any)
  html = html.replace(/(<br>)?\x00BLOCK(\d+)\x00(<br>)?/g, (_m, _pre, i) =>
    blocks[Number(i)]
  );

  return html;
}
