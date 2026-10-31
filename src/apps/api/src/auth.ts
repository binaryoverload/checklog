import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { db } from "./db/index.ts"
import { typeid } from "typeid-js"
import { prefixForTable } from "./util/typeid.ts"
import { config } from "./config.ts"

export const auth = betterAuth({
  secret: config.betterAuth.secret,
  baseURL: config.publicUrl,
  basePath: "/api/auth",
  emailAndPassword: {
    enabled: true,
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
  }),
  plugins: [
    organization({
      teams: {
        enabled: true,
      },
    }),
  ],
  advanced: {
    trustedProxyHeaders: true,
    database: {
      generateId: ({ model }) => typeid(prefixForTable(model)).toString(),
    },
  },
})
