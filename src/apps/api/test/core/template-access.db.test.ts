import { and, eq } from "drizzle-orm"
import { describe, expect, test } from "vitest"

import { assertTemplateAccessLevel, templateAccessLevel, visibleTemplatesWhere } from "@/core/permissions.ts"
import { organizations, teamMembers } from "@/db/auth-schema.ts"
import { templates } from "@/db/schema.ts"
import type { Database, PermissionContext } from "@/util/types.ts"
import { templateAccessIncludes, templateAccessLevels } from "@checklog/shared"
import type { TemplateAccessLevel } from "@checklog/shared"
import { addToGroup, createGroup, createMember, createOrganization, createTemplate, grant, inRollback } from "@test/support/database.ts"

async function visibleTemplateIds(tx: Database, context: PermissionContext, needs?: TemplateAccessLevel): Promise<string[]> {
  const rows = await tx.select({ id: templates.id }).from(templates).where(visibleTemplatesWhere(context, needs))
  return rows.map(row => row.id).sort()
}

describe("templateAccessLevel", () => {
  test("owners and admins can edit every template in their organization", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const templateId = await createTemplate(tx, organization)

    for (const role of ["owner", "admin"]) {
      const context = await createMember(tx, organization, role)
      expect(await templateAccessLevel(tx, context, templateId)).toBe("edit")
    }
  }))

  test("editors and viewers have no access without a grant", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const templateId = await createTemplate(tx, organization)

    for (const role of ["editor", "viewer"]) {
      const context = await createMember(tx, organization, role)
      expect(await templateAccessLevel(tx, context, templateId)).toBeNull()
    }
  }))

  test("a template's creator can edit it without a grant", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const creator = await createMember(tx, organization, "viewer")
    const templateId = await createTemplate(tx, organization, creator.member.userId)

    expect(await templateAccessLevel(tx, creator, templateId)).toBe("edit")
  }))

  test("a direct grant gives its level", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const context = await createMember(tx, organization, "viewer")
    const templateId = await createTemplate(tx, organization)
    await grant(tx, templateId, { organization, memberId: context.member.id }, "run")

    expect(await templateAccessLevel(tx, context, templateId)).toBe("run")
  }))

  test("a group grant gives its level to the group's members only", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const inGroup = await createMember(tx, organization, "viewer")
    const notInGroup = await createMember(tx, organization, "viewer")
    const teamId = await createGroup(tx, organization, [inGroup.member])
    const templateId = await createTemplate(tx, organization)
    await grant(tx, templateId, { organization, teamId }, "view")

    expect(await templateAccessLevel(tx, inGroup, templateId)).toBe("view")
    expect(await templateAccessLevel(tx, notInGroup, templateId)).toBeNull()
  }))

  test("the highest of several grants wins", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const context = await createMember(tx, organization, "viewer")
    const viewers = await createGroup(tx, organization, [context.member])
    const editors = await createGroup(tx, organization, [context.member])
    const templateId = await createTemplate(tx, organization)
    await grant(tx, templateId, { organization, teamId: viewers }, "view")
    await grant(tx, templateId, { organization, memberId: context.member.id }, "run")
    await grant(tx, templateId, { organization, teamId: editors }, "edit")

    expect(await templateAccessLevel(tx, context, templateId)).toBe("edit")
  }))

  test("leaving a group removes its grant", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const context = await createMember(tx, organization, "viewer")
    const teamId = await createGroup(tx, organization, [context.member])
    const templateId = await createTemplate(tx, organization)
    await grant(tx, templateId, { organization, teamId }, "run")

    await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, context.member.userId)))

    expect(await templateAccessLevel(tx, context, templateId)).toBeNull()
  }))

  test("another organization's template is unreachable, even for its owners", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const other = await createOrganization(tx, "Other organization")
    const owner = await createMember(tx, organization, "owner")
    const otherTemplateId = await createTemplate(tx, other, owner.member.userId)

    expect(await templateAccessLevel(tx, owner, otherTemplateId)).toBeNull()
  }))

  test("a grant to another organization's group never counts", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const other = await createOrganization(tx, "Other organization")
    const context = await createMember(tx, organization, "viewer")
    // The same person is in a group in the other organization, which is wrongly granted access to this organization's template
    const otherTeamId = await createGroup(tx, other)
    await addToGroup(tx, otherTeamId, context.member)
    const templateId = await createTemplate(tx, organization)
    await grant(tx, templateId, { organization, teamId: otherTeamId }, "edit")

    expect(await templateAccessLevel(tx, context, templateId)).toBeNull()
  }))

  test("a template that doesn't exist has no access", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const owner = await createMember(tx, organization, "owner")

    expect(await templateAccessLevel(tx, owner, "tmpl_missing")).toBeNull()
  }))

  test("a deleted organization gives no access", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const owner = await createMember(tx, organization, "owner")
    const templateId = await createTemplate(tx, organization)
    const [deleted] = await tx.update(organizations).set({ deletedAt: new Date() }).where(eq(organizations.id, organization.id)).returning()

    expect(await templateAccessLevel(tx, { ...owner, organization: deleted! }, templateId)).toBeNull()
  }))
})

describe("assertTemplateAccessLevel", () => {
  test("no access is not found, too little access is forbidden", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const context = await createMember(tx, organization, "viewer")
    const hidden = await createTemplate(tx, organization)
    const viewable = await createTemplate(tx, organization)
    await grant(tx, viewable, { organization, memberId: context.member.id }, "view")

    await expect(assertTemplateAccessLevel(tx, context, hidden, "view")).rejects.toMatchObject({ code: "not_found" })
    await expect(assertTemplateAccessLevel(tx, context, viewable, "run")).rejects.toMatchObject({ code: "forbidden" })
    await expect(assertTemplateAccessLevel(tx, context, viewable, "view")).resolves.toBeUndefined()
  }))
})

describe("visibleTemplatesWhere", () => {
  test("owners and admins see every template in their organization only", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const other = await createOrganization(tx, "Other organization")
    const ownTemplates = [await createTemplate(tx, organization), await createTemplate(tx, organization)]
    await createTemplate(tx, other)

    for (const role of ["owner", "admin"]) {
      const context = await createMember(tx, organization, role)
      expect(await visibleTemplateIds(tx, context)).toEqual(ownTemplates.sort())
    }
  }))

  test("the level asked for filters grants", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const context = await createMember(tx, organization, "viewer")
    const viewOnly = await createTemplate(tx, organization)
    const runnable = await createTemplate(tx, organization)
    await grant(tx, viewOnly, { organization, memberId: context.member.id }, "view")
    await grant(tx, runnable, { organization, memberId: context.member.id }, "run")

    expect(await visibleTemplateIds(tx, context)).toEqual([viewOnly, runnable].sort())
    expect(await visibleTemplateIds(tx, context, "run")).toEqual([runnable])
    expect(await visibleTemplateIds(tx, context, "edit")).toEqual([])
  }))

  test("a deleted organization lists nothing", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const owner = await createMember(tx, organization, "owner")
    await createTemplate(tx, organization)

    expect(await visibleTemplateIds(tx, { ...owner, organization: { ...organization, deletedAt: new Date() } })).toEqual([])
  }))

  // Lists must show exactly the templates that can be opened, or a page would link to a 404 or hide something reachable
  test("agrees with templateAccessLevel for every member, template and level", () => inRollback(async (tx) => {
    const organization = await createOrganization(tx)
    const other = await createOrganization(tx, "Other organization")

    const owner = await createMember(tx, organization, "owner")
    const editor = await createMember(tx, organization, "editor")
    const viewer = await createMember(tx, organization, "viewer")
    const grouped = await createMember(tx, organization, "viewer")
    const outsider = await createMember(tx, other, "owner")
    const teamId = await createGroup(tx, organization, [grouped.member, editor.member])

    const byEditor = await createTemplate(tx, organization, editor.member.userId)
    const sharedWithViewer = await createTemplate(tx, organization)
    const sharedWithGroup = await createTemplate(tx, organization)
    const sharedWithBoth = await createTemplate(tx, organization)
    const unshared = await createTemplate(tx, organization)
    const otherOrganization = await createTemplate(tx, other)
    await grant(tx, sharedWithViewer, { organization, memberId: viewer.member.id }, "view")
    await grant(tx, sharedWithGroup, { organization, teamId }, "run")
    await grant(tx, sharedWithBoth, { organization, memberId: grouped.member.id }, "view")
    await grant(tx, sharedWithBoth, { organization, teamId }, "edit")

    const allTemplates = [byEditor, sharedWithViewer, sharedWithGroup, sharedWithBoth, unshared, otherOrganization]
    for (const context of [owner, editor, viewer, grouped, outsider]) {
      for (const needs of templateAccessLevels) {
        const expected = []
        for (const templateId of allTemplates) {
          const level = await templateAccessLevel(tx, context, templateId)
          if (level && templateAccessIncludes(level, needs)) expected.push(templateId)
        }
        expect(await visibleTemplateIds(tx, context, needs), `${context.member.role} needing ${needs}`).toEqual(expected.sort())
      }
    }
  }))
})
