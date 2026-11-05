import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { betterAuth } from "better-auth"
import { admin, organization } from "better-auth/plugins"

import { db } from "@/db/index.ts"
import { typeIdForModel } from "@/util/typeid.ts"
import { platformAccessControl, platformRoles, platformAdminRoleName, orgRoles, orgAccessControl, organizationTypes } from "@checklog/shared"

import { config } from "./config.ts"

export const auth = betterAuth({
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.PUBLIC_URL,
  basePath: "/api/auth",
  emailAndPassword: {
    enabled: true,
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    // Endpoints that write several rows, such as sign-up, do it in one transaction
    transaction: true,
  }),
  plugins: [
    admin({
      ac: platformAccessControl,
      roles: platformRoles,
      defaultRole: "user",
      adminRoles: [platformAdminRoleName],
      bannedUserMessage: "Your account has been banned from Checklog",
    }),
    organization({
      ac: orgAccessControl,
      roles: orgRoles,
      creatorRole: "owner",
      disableOrganizationDeletion: true,
      teams: {
        enabled: true,
      },
      schema: {
        organization: {
          additionalFields: {
            accountType: {
              type: [...organizationTypes],
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
