function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`)
  }
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  publicUrl: required("PUBLIC_URL"),
  databaseUrl: required("DATABASE_URL"),
  migrateOnStart: process.env.MIGRATE_ON_START === "true",
  betterAuth: {
    secret: required("BETTER_AUTH_SECRET"),
  },
}
