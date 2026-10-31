import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { db } from "./db/index.ts"
import { typeid } from "typeid-js"
import { prefixForTable } from "./util/typeid.ts"
import { env } from "./env.ts"

export const auth = betterAuth({
  secret: env.betterAuth.secret,
  baseURL: env.publicUrl,
  basePath: "/api/auth",
  database: drizzleAdapter(db, {
    provider: "pg",
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
