/**
 * Web fetch tool — fetch content from URLs with SSRF protection.
 */
import { createLogger, recordAudit, validateUrl, getAllConfig, wrapExternalContent } from "@nexus/core";
import { registerTool } from "../tool-executor.js";

const log = createLogger("agent:tools:web_fetch");
const MAX_BODY = 200_000; // 200KB response limit
const TIMEOUT_MS = 15_000;

export function registerWebFetchTool(): void {
  registerTool({
    name: "web_fetch",
    description:
      "Fetch the text content of a URL. Returns the response body as plain text (HTML tags stripped for readability). Use for reading web pages, APIs, or documentation.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch (http or https)" },
        headers: {
          type: "object",
          description: "Optional HTTP headers to include in the request",
        },
      },
      required: ["url"],
    },
    async execute(input) {
      const url = input.url as string;
      const customHeaders = (input.headers ?? {}) as Record<string, string>;

      // SSRF guard check
      const securityConfig = getAllConfig().security;
      const validation = validateUrl(url, securityConfig.ssrfAllowlist.length > 0 ? securityConfig.ssrfAllowlist : undefined);
      if (!validation.safe) {
        log.warn({ url, reason: validation.reason }, "URL blocked by SSRF guard");
        return JSON.stringify({ error: `URL blocked: ${validation.reason}` });
      }

      recordAudit("web_fetch", "agent", { url });
      log.info({ url: url.slice(0, 200) }, "Fetching URL");

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(url, {
          headers: {
            "User-Agent": "Nexus/1.0",
            Accept: "text/html, application/json, text/plain, */*",
            ...customHeaders,
          },
          signal: controller.signal,
          redirect: "follow",
        });

        clearTimeout(timeout);

        if (!response.ok) {
          return JSON.stringify({
            error: `HTTP ${response.status} ${response.statusText}`,
            url,
          });
        }

        const contentType = response.headers.get("content-type") ?? "";
        let body = await response.text();

        // Truncate to limit
        if (body.length > MAX_BODY) {
          body = body.slice(0, MAX_BODY) + "\n\n[... truncated at 200KB]";
        }

        // Strip HTML tags for readability if HTML content
        if (contentType.includes("text/html")) {
          body = stripHtml(body);
        }

        // Wrap in content boundary markers for security
        const wrapped = wrapExternalContent(url, body);

        return wrapped;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ url, error: msg }, "Fetch failed");
        return JSON.stringify({ error: msg, url });
      }
    },
  });
}

/** Basic HTML stripping — removes tags, decodes common entities, collapses whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
