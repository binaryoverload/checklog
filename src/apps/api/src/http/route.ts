import { fromNodeHeaders } from "better-auth/node"
import { and, eq } from "drizzle-orm"
import type { Request, RequestHandler, Response } from "express"
import type { z } from "zod"

import { auth } from "@/core/auth.ts"
import type { organizations } from "@/db/auth-schema.ts"
import { members } from "@/db/auth-schema.ts"
import { db } from "@/db/index.ts"
import type { ApiErrorDetail } from "@checklog/shared"

import { HttpError } from "./errors.ts"

type RouteOptions = {
  /**
   * The authentication requirement for this route
   * @default "private"
   */
  auth?: "public" | "private"
  /**
   * Whether to load the organization for this route.
   *
   * When auth is "public", "none" will be used automatically.
   * @default "required"
   */
  organization?: "required" | "none"
  params?: z.ZodType
  query?: z.ZodType
  body?: z.ZodType
}

// The parsed values, for only the parts that have a schema
type ParsedSchemas<S extends RouteOptions> = {
  [K in keyof S as S[K] extends z.ZodType ? K : never]: z.output<S[K]>
}

type Session = typeof auth.$Infer.Session
type Organization = typeof organizations.$inferSelect
type Member = typeof members.$inferSelect
type ActiveOrganization = {
  organization: Organization
  member: Member
}

type RouteContext<S extends RouteOptions> = {
  req: Request
  res: Response
  session: S["auth"] extends "public" ? Session | null : Session
  organization: S["auth"] extends "public" ? null : S["organization"] extends "none" ? null : Organization
  member: S["auth"] extends "public" ? null : S["organization"] extends "none" ? null : Member
} & ParsedSchemas<S>

type RouteHandler<S extends RouteOptions> = (context: RouteContext<S>) => void | Promise<void>

// Handles route validation, authentication and loading the organisation before invoking the handler.
export function route<S extends RouteOptions>(options: S, handler: RouteHandler<S>): RequestHandler {
  const optionsWithDefaults = {
    auth: "private",
    organization: "required",
    ...options,
  }
  return async (req, res) => {
    const input: Record<string, unknown> = {}
    const details: ApiErrorDetail[] = []

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    })

    if (!session && optionsWithDefaults.auth === "private") {
      throw new HttpError("unauthorized", "Authentication required")
    }

    let activeOrganization: ActiveOrganization | null = null
    if (session && optionsWithDefaults.auth === "private" && optionsWithDefaults.organization === "required") {
      activeOrganization = await loadActiveOrganization(session)
    }

    for (const location of ["params", "query", "body"] as const) {
      const schema = options[location]
      if (!schema) continue

      const result = schema.safeParse(req[location])
      if (result.success) {
        input[location] = result.data
      } else {
        for (const issue of result.error.issues) {
          details.push({
            location,
            path: issue.path.map(key => (typeof key === "number" ? key : String(key))),
            message: issue.message,
          })
        }
      }
    }

    if (details.length > 0) {
      throw new HttpError("validation_failed", "The request is invalid", details)
    }

    // Cast required because TypeScript cannot narrow the type of session based on the options
    await handler({
      ...input,
      req,
      res,
      session,
      organization: activeOrganization?.organization ?? null,
      member: activeOrganization?.member ?? null,
    } as RouteContext<S>,
    )
  }
}

async function loadActiveOrganization(session: Session): Promise<ActiveOrganization> {
  const organizationId = session.session.activeOrganizationId
  if (!organizationId) {
    throw new HttpError("no_active_organization", "Choose an organization to continue")
  }

  const row = await db.query.members.findFirst({
    where: and(eq(members.organizationId, organizationId), eq(members.userId, session.user.id)),
    with: { organization: true },
  })
  if (!row) {
    throw new HttpError("forbidden", "You are not a member of this organization")
  }
  if (row.organization.deletedAt) {
    throw new HttpError("organization_deleted", "This organization has been deleted")
  }
  const { organization, ...member } = row
  return {
    organization,
    member,
  }
}
