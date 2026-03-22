import pino from "pino";

export function createLogger(name: string, level = "info") {
  return pino({
    name,
    level,
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
