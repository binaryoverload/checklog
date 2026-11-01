import { z } from "zod"

const configSchema = z.object({
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "verbose", "debug", "silly"]).default("info"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),

  PORT: z.coerce.number().default(3001),
  // httpUrl() needs a dotted hostname, so it rejects localhost
  PUBLIC_URL: z.url({ protocol: /^https?$/ }),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  MIGRATE_ON_START: z.stringbool().default(false),

  BETTER_AUTH_SECRET: z.string().min(32),

  EMAIL_SMTP_HOST: z.string(),
  EMAIL_SMTP_PORT: z.coerce.number().default(587),
  EMAIL_SMTP_SECURE: z.stringbool().default(false),
  EMAIL_SMTP_USER: z.string().optional(),
  EMAIL_SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.email(),
  EMAIL_FROM_NAME: z.string().optional(),
}).refine((data) => {
  if (data.EMAIL_SMTP_USER && !data.EMAIL_SMTP_PASSWORD) return false
  if (!data.EMAIL_SMTP_USER && data.EMAIL_SMTP_PASSWORD) return false
  return true
}, {
  message: "Both EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD must be set together",
})

export type Config = z.infer<typeof configSchema>

// Blank values (`NAME=` in .env) count as unset, so defaults and optionals apply
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== ""),
)

export const config: Config = configSchema.parse(env)
