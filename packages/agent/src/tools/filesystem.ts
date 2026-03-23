/**
 * Filesystem tools — read, write, list files.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveSafePath, getDefaultMounts } from "@nexus/core";
import { registerTool } from "../tool-executor.js";

/** Validate a path against the current workspace mounts. Returns the
 *  canonical safe path, or a JSON error string if denied. */
function guardPath(requestedPath: string): { safe: string } | { errorJson: string } {
  const roots = getDefaultMounts().map((m) => m.root);
  const safe = resolveSafePath(requestedPath, roots);
  if (!safe) {
    return {
      errorJson: JSON.stringify({
        error: `Access denied: "${requestedPath}" is outside the allowed workspace`,
      }),
    };
  }
  return { safe };
}

export function registerFilesystemTools(): void {
  registerTool({
    name: "read_file",
    description: "Read the contents of a file at the given path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
      },
      required: ["path"],
    },
    async execute(input) {
      const filePath = input.path as string;
      if (!path.isAbsolute(filePath)) {
        return JSON.stringify({ error: "Path must be absolute" });
      }
      const guard = guardPath(filePath);
      if ("errorJson" in guard) return guard.errorJson;
      const safePath = guard.safe;
      if (!fs.existsSync(safePath)) {
        return JSON.stringify({ error: `File not found: ${safePath}` });
      }
      const stat = fs.statSync(safePath);
      if (stat.isDirectory()) {
        return JSON.stringify({ error: "Path is a directory, not a file" });
      }
      if (stat.size > 1_000_000) {
        return JSON.stringify({ error: "File too large (>1MB)" });
      }
      return fs.readFileSync(safePath, "utf-8");
    },
  });

  registerTool({
    name: "write_file",
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    async execute(input) {
      const filePath = input.path as string;
      const content = input.content as string;
      if (!path.isAbsolute(filePath)) {
        return JSON.stringify({ error: "Path must be absolute" });
      }
      const guard = guardPath(filePath);
      if ("errorJson" in guard) return guard.errorJson;
      const safePath = guard.safe;
      fs.mkdirSync(path.dirname(safePath), { recursive: true });
      fs.writeFileSync(safePath, content, "utf-8");
      return JSON.stringify({ ok: true, path: safePath, bytes: Buffer.byteLength(content) });
    },
  });

  registerTool({
    name: "list_directory",
    description: "List files and directories at the given path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the directory" },
      },
      required: ["path"],
    },
    async execute(input) {
      const dirPath = input.path as string;
      if (!path.isAbsolute(dirPath)) {
        return JSON.stringify({ error: "Path must be absolute" });
      }
      const guard = guardPath(dirPath);
      if ("errorJson" in guard) return guard.errorJson;
      const safePath = guard.safe;
      if (!fs.existsSync(safePath)) {
        return JSON.stringify({ error: `Directory not found: ${safePath}` });
      }
      const entries = fs.readdirSync(safePath, { withFileTypes: true });
      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      }));
      return JSON.stringify(items);
    },
  });
}
