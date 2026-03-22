/**
 * Filesystem tools — read, write, list files.
 */
import fs from "node:fs";
import path from "node:path";
import { registerTool } from "../tool-executor.js";

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
      if (!fs.existsSync(filePath)) {
        return JSON.stringify({ error: `File not found: ${filePath}` });
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return JSON.stringify({ error: "Path is a directory, not a file" });
      }
      if (stat.size > 1_000_000) {
        return JSON.stringify({ error: "File too large (>1MB)" });
      }
      return fs.readFileSync(filePath, "utf-8");
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
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      return JSON.stringify({ ok: true, path: filePath, bytes: Buffer.byteLength(content) });
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
      if (!fs.existsSync(dirPath)) {
        return JSON.stringify({ error: `Directory not found: ${dirPath}` });
      }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      }));
      return JSON.stringify(items);
    },
  });
}
