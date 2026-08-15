/* Lightweight structured logger. No external dependency. */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return (raw as LogLevel) in LEVEL_ORDER ? (raw as LogLevel) : "info";
}

function emit(level: LogLevel, args: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) {
    return;
  }
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  const target = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  target(prefix, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => emit("debug", args),
  info: (...args: unknown[]) => emit("info", args),
  warn: (...args: unknown[]) => emit("warn", args),
  error: (...args: unknown[]) => emit("error", args),
  child: (context: string) => ({
    debug: (...args: unknown[]) => emit("debug", [`(${context})`, ...args]),
    info: (...args: unknown[]) => emit("info", [`(${context})`, ...args]),
    warn: (...args: unknown[]) => emit("warn", [`(${context})`, ...args]),
    error: (...args: unknown[]) => emit("error", [`(${context})`, ...args]),
  }),
};

export type Logger = ReturnType<typeof logger.child>;
