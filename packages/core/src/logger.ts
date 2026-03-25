import pino from "pino";
import type { Logger as PinoLogger } from "pino";

/** All loggers created via createLogger, keyed by namespace. */
const loggers = new Map<string, PinoLogger>();

/** Current global log level (defaults to "info"). */
let currentLevel: string = "info";

/**
 * Create a namespaced pino logger.
 *
 * The level is determined by (in priority order):
 *   1. The explicit `level` argument
 *   2. The current global level set via `setLogLevel()`
 *
 * Every logger is tracked so that `setLogLevel()` can update them all.
 */
export function createLogger(name: string, level?: string): PinoLogger {
  const effectiveLevel = level ?? currentLevel;
  const logger = pino({
    name,
    level: effectiveLevel,
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });
  loggers.set(name, logger);
  return logger;
}

/**
 * Update the log level for ALL existing loggers and future loggers.
 */
export function setLogLevel(level: string): void {
  currentLevel = level;
  for (const logger of loggers.values()) {
    logger.level = level;
  }
}

/**
 * Initialise the log level from config.
 *
 * Call this once during startup (after the DB is ready) to read
 * `gateway.verbose` and wire up the `config:changed` listener.
 *
 * Uses dynamic import to avoid a circular dependency (config.ts imports logger.ts).
 */
export async function initLogLevel(): Promise<void> {
  const { getAllConfig } = await import("./config.js");
  const { events } = await import("./events.js");

  try {
    const config = getAllConfig();
    if (typeof config.gateway.verbose === "boolean" && config.gateway.verbose) {
      setLogLevel("debug");
    }
  } catch {
    // DB may not be ready yet — keep default level.
  }

  events.on("config:changed", (payload) => {
    if (payload.key === "gateway" && typeof payload.value === "object" && payload.value !== null) {
      const gw = payload.value as Record<string, unknown>;
      if (typeof gw["verbose"] === "boolean") {
        setLogLevel(gw["verbose"] ? "debug" : "info");
      }
    }
  });
}

export type Logger = PinoLogger;
