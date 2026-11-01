import winston from "winston"

import { config } from "./config.ts"

const { colorize, combine, errors, json, printf, timestamp } = winston.format

// Readable lines with local time; extra fields are printed after the message
const pretty = printf(({ level, message, timestamp, stack, ...meta }) => {
  const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ""
  return `${String(timestamp)} ${level} ${String(message)}${extra}${stack ? `\n${String(stack)}` : ""}`
})

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: combine(
    errors({ stack: true }),
    // LOG_FORMAT=json gives one object per line with ISO timestamps, for log collectors
    config.LOG_FORMAT === "json"
      ? combine(timestamp(), json())
      : combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), colorize(), pretty),
  ),
  transports: [new winston.transports.Console()],
})
