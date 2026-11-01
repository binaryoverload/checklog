import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"

import { config } from "./config.ts"
import { db } from "./db/index.ts"
import { typeIdForModel } from "./util/typeid.ts"

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
      disableOrganizationDeletion: true,
      teams: {
        enabled: true,
      },
      schema: {
        organization: {
          additionalFields: {
            accountType: {
              type: ["personal", "managed"],
              required: true,
              input: false,
              defaultValue: "personal",
            },
            deletedAt: {
              type: "date",
              required: false,
              input: false,
            },
            deletedBy: {
              type: "string",
              required: false,
              input: false,
              references: {
                model: "user",
                field: "id",
                onDelete: "set null",
              },
            },
            purgeAfter: {
              type: "date",
              required: false,
              input: false,
              index: true,
            },
          },
        },
      },
    }),
  ],
  user: {
    additionalFields: {
      managedByOrganizationId: {
        type: "string",
        required: false,
        input: false,
        references: { model: "organization", field: "id", onDelete: "restrict" },
      },
    },
  },
  advanced: {
    trustedProxyHeaders: true,
    database: {
      generateId: ({ model }) => typeIdForModel(model).toString(),
    },
  },
})
