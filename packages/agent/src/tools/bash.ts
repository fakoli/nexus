/**
 * Bash tool — execute shell commands with basic safety guards.
 */
import { execSync } from "node:child_process";
import { createLogger, recordAudit } from "@nexus/core";
import { registerTool } from "../tool-executor.js";

const log = createLogger("agent:tools:bash");
const MAX_OUTPUT = 100_000; // 100KB output limit
const TIMEOUT_MS = 30_000; // 30s timeout

const BLOCKED_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+\//, // rm -rf /*, rm -rf /etc, etc.
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*r[a-zA-Z]*)?\s*\/\*/, // rm -f /*, rm /*
  /\bmkfs\b/,               // format disk
  /\b(shutdown|reboot|halt|poweroff)\b/, // system control
  />\s*\/dev\/sd/,           // write to raw block devices
  />\s*\/dev\/nvme/,         // write to raw NVMe devices
  /\bdd\b.*\bof=\/dev\/(sd|nvme|hd)/, // dd to raw devices
  /\bchmod\s+-R\s+[0-7]*7[0-7]*\s+\//, // chmod -R 777 / (world-writable root)
  /:\(\)\{\s*:\|:\s*&\s*\};\s*:/, // fork bomb
];

export function registerBashTool(): void {
  registerTool({
    name: "bash",
    description: "Execute a bash command and return stdout/stderr. Use for system commands, git, npm, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to execute" },
      },
      required: ["command"],
    },
    async execute(input) {
      const command = input.command as string;

      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(command)) {
          log.warn({ command }, "Blocked dangerous command");
          return JSON.stringify({ error: "Command blocked by safety policy" });
        }
      }

      const workingDir = process.cwd();
      recordAudit("bash_execution", "agent", { command, workingDir });
      log.info({ command: command.slice(0, 200), workingDir }, "Executing bash");

      try {
        const output = execSync(command, {
          encoding: "utf-8",
          timeout: TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, TERM: "dumb" },
        });
        return output || "(no output)";
      } catch (err: unknown) {
        if (err !== null && typeof err === "object") {
          const execErr = err as { status?: number; stdout?: string; stderr?: string; message?: string };
          const stderr = execErr.stderr ?? "";
          const stdout = execErr.stdout ?? "";
          const exitCode = execErr.status ?? 1;
          return `Exit code: ${exitCode}\n${stdout}${stderr}`.trim() || execErr.message || "Command failed";
        }
        return err instanceof Error ? err.message : "Command failed";
      }
    },
  });
}
