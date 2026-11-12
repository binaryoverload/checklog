import type request from "supertest"
import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import type { Organization, Template } from "@/util/types.ts"
import { templateAccessLevels } from "@checklog/shared/domain"
import type { TemplateAccessLevel, TemplateStatus } from "@checklog/shared/domain"
import { typeIdForTable } from "@checklog/shared/utils"
import { addToGroup, createGroup, createMember, createOrganization, grant, insertTemplate } from "@test/support/database.ts"
import { expectError, expectStatus } from "@test/support/http.ts"
import { signedInMember } from "@test/support/session.ts"
import { storedTemplate } from "@test/support/template-drafts.ts"

// A route on one template, so the access and ID rules are checked the same way for each
export interface TemplateRoute {
  name: string
  send: (templateId: string) => PromiseLike<request.Response>
  needs: TemplateAccessLevel
  impersonation: "allow" | "refuse"
  // The status the template needs for the request to succeed, and the one that makes it a conflict
  status: TemplateStatus
  conflictStatus?: TemplateStatus
  // The status a successful request returns, when it isn't 200
  successStatus?: number
  // Sets up rows the request needs on a new template, before the template is compared for changes
  prepare?: (template: Template) => Promise<Template | void>
}

// Call from a file that calls stubSessions()
export function describeTemplateAccess(routes: TemplateRoute[]): void {
  // A loop rather than describe.each, which shortens long route names in the title so -t filters can miss them
  for (const route of routes) describe(`${route.name} access`, () => {
    const successStatus = route.successStatus ?? 200
    const allowedLevels = templateAccessLevels.slice(templateAccessLevels.indexOf(route.needs))
    const lowerLevels = templateAccessLevels.slice(0, templateAccessLevels.indexOf(route.needs))

    async function templateIn(organization: Organization, options: { createdBy?: string, status?: TemplateStatus } = {}) {
      const template = await insertTemplate(db, organization, { status: route.status, ...options })
      return (await route.prepare?.(template)) ?? template
    }

    async function expectUnchanged(template: Template) {
      expect(await storedTemplate(template.id)).toEqual(template)
    }

    test.each(["owner", "admin"])("lets an %s make the request", async (role) => {
      const { organization } = await signedInMember(role)
      const template = await templateIn(organization)

      expectStatus(await route.send(template.id), successStatus)
    })

    test.each(["editor", "viewer"])("lets a member with the %s role who created the template make the request", async (role) => {
      const { organization, member } = await signedInMember(role)
      const template = await templateIn(organization, { createdBy: member.userId })

      expectStatus(await route.send(template.id), successStatus)
    })

    test.each(allowedLevels)("lets a member with %s access make the request", async (level) => {
      const { organization, member } = await signedInMember("viewer")
      const template = await templateIn(organization)
      await grant(db, template.id, { organization, memberId: member.id }, level)

      expectStatus(await route.send(template.id), successStatus)
    })

    test(`lets a member whose group has ${route.needs} access make the request`, async () => {
      const { organization, member } = await signedInMember("viewer")
      const teamId = await createGroup(db, organization)
      await addToGroup(db, teamId, member)
      const template = await templateIn(organization)
      await grant(db, template.id, { organization, teamId }, route.needs)

      expectStatus(await route.send(template.id), successStatus)
    })

    if (lowerLevels.length > 0) {
      test.each(lowerLevels)("refuses a member with only %s access with forbidden and changes nothing", async (level) => {
        const { organization, member } = await signedInMember("viewer")
        const template = await templateIn(organization)
        await grant(db, template.id, { organization, memberId: member.id }, level)

        expectError(await route.send(template.id), 403, "forbidden")
        await expectUnchanged(template)
      })
    }

    test("refuses a template the member can't see with not_found and changes nothing", async () => {
      const { organization } = await signedInMember("viewer")
      const template = await templateIn(organization)

      expectError(await route.send(template.id), 404, "not_found")
      await expectUnchanged(template)
    })

    test("refuses a template granted only to someone else with not_found", async () => {
      const { organization } = await signedInMember("viewer")
      const { member: someoneElse } = await createMember(db, organization, "viewer")
      const template = await templateIn(organization)
      await grant(db, template.id, { organization, memberId: someoneElse.id }, "edit")

      expectError(await route.send(template.id), 404, "not_found")
    })

    test("refuses another organization's template with not_found and changes nothing", async () => {
      const other = await createOrganization(db)
      const template = await templateIn(other)
      await signedInMember("owner")

      expectError(await route.send(template.id), 404, "not_found")
      await expectUnchanged(template)
    })

    test("refuses an ID that doesn't exist with not_found", async () => {
      await signedInMember("owner")

      expectError(await route.send(typeIdForTable("templates").toString()), 404, "not_found")
    })

    test.each([
      ["an ID that isn't a TypeID", "not-an-id"],
      ["an ID for another table", typeIdForTable("runs").toString()],
    ])("refuses %s with validation_failed", async (_description, templateId) => {
      await signedInMember("owner")

      expectError(await route.send(templateId), 400, "validation_failed")
    })

    test("refuses a signed-out request with unauthorized", async () => {
      expectError(await route.send(typeIdForTable("templates").toString()), 401, "unauthorized")
    })

    if (route.impersonation === "refuse") {
      test("refuses an impersonated session with forbidden and changes nothing", async () => {
        const { organization } = await signedInMember("owner", { impersonatedBy: "user_operator" })
        const template = await templateIn(organization)

        expectError(await route.send(template.id), 403, "forbidden")
        await expectUnchanged(template)
      })
    } else {
      test("allows an impersonated session", async () => {
        const { organization } = await signedInMember("owner", { impersonatedBy: "user_operator" })
        const template = await templateIn(organization)

        expectStatus(await route.send(template.id), successStatus)
      })
    }

    const conflictStatus = route.conflictStatus
    if (conflictStatus) {
      test(`refuses a member with edit access with conflict when the template is ${conflictStatus}`, async () => {
        const { organization, member } = await signedInMember("viewer")
        const template = await templateIn(organization, { status: conflictStatus })
        await grant(db, template.id, { organization, memberId: member.id }, "edit")

        expectError(await route.send(template.id), 409, "conflict")
        await expectUnchanged(template)
      })

      test(`refuses a member with view access with forbidden, not conflict, when the template is ${conflictStatus}`, async () => {
        const { organization, member } = await signedInMember("viewer")
        const template = await templateIn(organization, { status: conflictStatus })
        await grant(db, template.id, { organization, memberId: member.id }, "view")

        expectError(await route.send(template.id), 403, "forbidden")
      })

      test(`refuses a template the member can't see with not_found, not conflict, when it's ${conflictStatus}`, async () => {
        const { organization } = await signedInMember("viewer")
        const template = await templateIn(organization, { status: conflictStatus })

        expectError(await route.send(template.id), 404, "not_found")
      })
    }
  })
}
