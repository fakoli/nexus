/**
 * Web search tool — search the web via Brave Search API or DuckDuckGo fallback.
 */
import { z } from "zod";
import { createLogger, recordAudit } from "@nexus/core";
import { registerTool } from "../tool-executor.js";

const log = createLogger("agent:tools:web_search");

// ── Input validation ─────────────────────────────────────────────────

const WebSearchInput = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(10).default(5),
});

// ── Rate limiting (in-memory, per-process) ───────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

interface RateWindow {
  timestamps: number[];
}

const rateWindow: RateWindow = { timestamps: [] };

function checkSearchRateLimit(): boolean {
  const now = Date.now();
  rateWindow.timestamps = rateWindow.timestamps.filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (rateWindow.timestamps.length >= RATE_LIMIT_MAX) {
    return false;
  }
  rateWindow.timestamps.push(now);
  return true;
}

// ── Query sanitisation ───────────────────────────────────────────────

/** Remove characters that could cause injection in search APIs. */
function sanitizeQuery(raw: string): string {
  return raw.replace(/[<>"'`;|&$\\{}[\]]/g, " ").replace(/\s{2,}/g, " ").trim();
}

// ── Search result type ───────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ── Brave Search backend ─────────────────────────────────────────────

async function searchBrave(query: string, count: number): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    log.warn({ status: response.status }, "Brave Search API error");
    return [];
  }

  const data = (await response.json()) as {
    web?: { results?: Array<{ title: string; url: string; description: string }> };
  };

  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

// ── DuckDuckGo HTML fallback ─────────────────────────────────────────

async function searchDuckDuckGo(query: string, count: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Nexus/1.0",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    log.warn({ status: response.status }, "DuckDuckGo fallback error");
    return [];
  }

  const html = await response.text();
  return parseDuckDuckGoHtml(html, count);
}

/** Extract search results from DuckDuckGo HTML response. */
function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let match: RegExpExecArray | null;

  match = resultPattern.exec(html);
  while (match !== null) {
    const rawUrl = match[1];
    const title = stripTags(match[2]);
    const decodedUrl = decodeURIComponent(
      rawUrl.replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0],
    );
    links.push({ url: decodedUrl, title });
    match = resultPattern.exec(html);
  }

  const snippets: string[] = [];
  match = snippetPattern.exec(html);
  while (match !== null) {
    snippets.push(stripTags(match[1]));
    match = snippetPattern.exec(html);
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] ?? "",
    });
  }

  return results;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s{2,}/g, " ").trim();
}

// ── Format output ────────────────────────────────────────────────────

function formatResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `No search results found for: "${query}"`;
  }

  const lines = [`Search results for: "${query}"\n`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   URL: ${r.url}`);
    if (r.snippet) {
      lines.push(`   ${r.snippet}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

// ── Tool registration ────────────────────────────────────────────────

export function registerWebSearchTool(): void {
  registerTool({
    name: "web_search",
    description:
      "Search the web for information. Returns titles, URLs, and snippets. " +
      "Use when you need current information not in your training data.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query (1-500 characters)",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (1-10, default 5)",
        },
      },
      required: ["query"],
    },
    async execute(input) {
      const parsed = WebSearchInput.safeParse(input);
      if (!parsed.success) {
        return JSON.stringify({ error: `Invalid input: ${parsed.error.message}` });
      }

      if (!checkSearchRateLimit()) {
        log.warn("Web search rate limit exceeded");
        return JSON.stringify({ error: "Rate limit exceeded — max 10 searches per minute" });
      }

      const sanitized = sanitizeQuery(parsed.data.query);
      if (sanitized.length === 0) {
        return JSON.stringify({ error: "Query is empty after sanitisation" });
      }

      recordAudit("web_search", "agent", { query: sanitized, maxResults: parsed.data.maxResults });
      log.info({ query: sanitized, maxResults: parsed.data.maxResults }, "Performing web search");

      try {
        // Try Brave first, fall back to DuckDuckGo
        let results = await searchBrave(sanitized, parsed.data.maxResults);
        if (results.length === 0) {
          log.debug("Brave returned no results, falling back to DuckDuckGo");
          results = await searchDuckDuckGo(sanitized, parsed.data.maxResults);
        }
        return formatResults(results, sanitized);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ query: sanitized, error: msg }, "Web search failed");
        return JSON.stringify({ error: msg });
      }
    },
  });
}
