type LogMeta = Record<string, unknown>;

const isProduction = process.env.NODE_ENV === "production";

function formatLog(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  meta?: LogMeta,
) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
  };
  return isProduction ? JSON.stringify(entry) : `[${level.toUpperCase()}] ${message}${meta ? " " + JSON.stringify(meta) : ""}`;
}

function log(level: "info" | "warn" | "error" | "debug", message: string, meta?: LogMeta) {
  const formatted = formatLog(level, message, meta);
  switch (level) {
    case "error":
      console.error(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "debug":
      if (!isProduction) console.debug(formatted);
      break;
    default:
      console.log(formatted);
  }
}

export const logger = {
  info: (message: string, meta?: LogMeta) => log("info", message, meta),
  warn: (message: string, meta?: LogMeta) => log("warn", message, meta),
  error: (message: string, meta?: LogMeta) => log("error", message, meta),
  debug: (message: string, meta?: LogMeta) => log("debug", message, meta),
} as const;
