/**
 * Web fetch tool — fetch content from URLs with SSRF protection.
 */
import { createLogger, recordAudit, validateUrl, getAllConfig, wrapExternalContent } from "@nexus/core";
import { registerTool } from "../tool-executor.js";

const log = createLogger("agent:tools:web_fetch");
const MAX_BODY = 200_000; // 200KB response limit
const TIMEOUT_MS = 15_000;

/** Headers that must never be overridden by the agent. */
const BLOCKED_HEADERS = new Set([
  "host",
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-forwarded-for",
  "x-real-ip",
]);

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
      const rawHeaders = (input.headers ?? {}) as Record<string, string>;

      // Strip blocked headers (case-insensitive)
      const safeHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (!BLOCKED_HEADERS.has(key.toLowerCase())) {
          safeHeaders[key] = value;
        } else {
          log.warn({ header: key }, "Stripped blocked header from web_fetch request");
        }
      }

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
            ...safeHeaders,
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

        // Read body incrementally to enforce byte limit without buffering entire response
        let body = await readBodyWithLimit(response, MAX_BODY);

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

/**
 * Read a response body up to maxBytes, then cancel the stream.
 * Prevents OOM from unbounded response bodies.
 */
async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return response.text();
  }

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        // Decode only the portion within the limit
        const overshoot = totalBytes - maxBytes;
        const usable = value.slice(0, value.byteLength - overshoot);
        if (usable.byteLength > 0) {
          chunks.push(decoder.decode(usable, { stream: false }));
        }
        truncated = true;
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  let body = chunks.join("");
  if (truncated) {
    body += "\n\n[... truncated at 200KB]";
  }
  return body;
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
