import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";

// Base logger — outputs JSON to stdout, readable by any log aggregator.
// In development, pipe through `pino-pretty` for human output:
//   node server.js | npx pino-pretty
export const logger = pino({
  level: LOG_LEVEL,
  base: { pid: process.pid, service: "openclaw-observer" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label })
  }
});

/**
 * Create a child logger with fixed bindings, e.g. for a task or request scope.
 * @param {object} bindings - Fields attached to every log line from this child.
 */
export function childLogger(bindings = {}) {
  return logger.child(bindings);
}

/**
 * Drop-in replacement for console.log/warn/error in legacy code.
 * Routes to the appropriate pino level so structured output is preserved.
 */
export function legacyLog(level = "info", ...args) {
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  logger[level]?.(msg);
}
