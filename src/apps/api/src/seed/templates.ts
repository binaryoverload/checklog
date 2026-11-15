import { and, eq } from "drizzle-orm"

import { logger } from "@/core/logger.ts"
import { db } from "@/db/index.ts"
import { templateAccess, templateFields, templates, templateSteps, templateVersions } from "@/db/schema.ts"
import type { SeededOrganization } from "@/seed/accounts.ts"
import type { SeedGroupName } from "@/seed/groups.ts"
import type { Transaction } from "@/util/types.ts"
import type { OrgRole } from "@checklog/shared/auth"
import { assigneeToFlat } from "@checklog/shared/domain"
import type { Assignee, FieldOptions, TemplateAccessLevel, TemplateStepKind, TemplateVersionStatus } from "@checklog/shared/domain"

// Who a seeded step is assigned to: a seeded member by their role, a seeded group, or an organization role
type SeedAssignee = { member: OrgRole } | { group: SeedGroupName } | { role: OrgRole }

interface SeedField {
  key: string
  label: string
  helpText?: string
  required?: boolean
  options: FieldOptions
}

interface SeedStep {
  title: string
  instructions?: string
  kind?: TemplateStepKind
  isHalt?: boolean
  skippable?: boolean
  assignee?: SeedAssignee
  dueOffset?: string
  fields?: SeedField[]
}

interface SeedVersion {
  status: TemplateVersionStatus
  steps: SeedStep[]
}

interface SeedTemplate {
  name: string
  description?: string
  status?: "active" | "archived"
  // The seeded member who created it, by role; the owner when not given
  createdBy?: OrgRole
  // Numbered from 1 in this order. The current version is the last published one
  versions: SeedVersion[]
  access?: { to: { member: OrgRole } | { group: SeedGroupName }, level: TemplateAccessLevel }[]
}

const serverCheckSteps: SeedStep[] = [
  {
    title: "Check disk space",
    instructions: "Check free space on each production server. Anything under **20 GB** needs raising.",
    assignee: { role: "editor" },
    dueOffset: "P1D",
    fields: [
      { key: "free_disk_gb", label: "Lowest free disk space", options: { type: "number", min: 0, decimalPlaces: 1, unit: "GB" } },
      { key: "backups_ran", label: "Last night's backups ran", options: { type: "checkbox" } },
    ],
  },
  {
    title: "Review error logs",
    assignee: { group: "Maintenance" },
    dueOffset: "PT4H",
    fields: [
      { key: "log_notes", label: "Anything unusual", required: false, options: { type: "text", multiLine: true, maxLength: 2000 } },
    ],
  },
  {
    title: "Restart services if needed",
    skippable: true,
    assignee: { member: "editor" },
  },
  {
    title: "Sign off",
    kind: "approval",
    isHalt: true,
    assignee: { member: "admin" },
    fields: [
      { key: "sign_off_comments", label: "Comments", required: false, options: { type: "text", multiLine: true } },
    ],
  },
]

export const templateDefinitions: SeedTemplate[] = [
  {
    name: "Weekly server checks",
    description: "Disk, logs and services on the production servers",
    versions: [
      { status: "published", steps: serverCheckSteps },
      // Being edited: adds a certificate check before the sign-off
      {
        status: "draft",
        steps: [
          ...serverCheckSteps.slice(0, 3),
          {
            title: "Check TLS certificate expiry",
            assignee: { group: "Maintenance" },
            fields: [
              { key: "certificate_expires", label: "Earliest expiry date", options: { type: "date", dateType: "date", allowFuture: true } },
            ],
          },
          serverCheckSteps[3]!,
        ],
      },
    ],
    access: [
      { to: { member: "viewer" }, level: "view" },
      { to: { member: "editor" }, level: "run" },
    ],
  },
  {
    name: "Fridge temperature log",
    description: "Twice-daily check of the kitchen fridges",
    versions: [
      {
        status: "published",
        steps: [
          {
            title: "Record fridge temperatures",
            assignee: { group: "Kitchen" },
            dueOffset: "PT2H",
            fields: [
              { key: "fridge_1_temp", label: "Fridge 1", options: { type: "number", min: -5, max: 8, decimalPlaces: 1, unit: "°C" } },
              { key: "fridge_2_temp", label: "Fridge 2", options: { type: "number", min: -5, max: 8, decimalPlaces: 1, unit: "°C" } },
              {
                key: "door_seals",
                label: "Door seals",
                options: {
                  type: "dropdown",
                  choices: [{ value: "good", label: "Good" }, { value: "worn", label: "Worn" }, { value: "damaged", label: "Damaged" }],
                  multiple: false,
                },
              },
              { key: "checked_at", label: "Time checked", options: { type: "date", dateType: "time", allowFuture: false } },
            ],
          },
          {
            title: "Report a fault",
            instructions: "Only if a fridge is out of range or a seal is damaged.",
            skippable: true,
            assignee: { group: "Kitchen" },
            fields: [
              {
                key: "asset_tag",
                label: "Asset tag",
                helpText: "Three letters, a hyphen and four digits, as on the sticker",
                options: { type: "text", multiLine: false, pattern: "[A-Z]{3}-[0-9]{4}" },
              },
              { key: "fault_description", label: "What's wrong", options: { type: "text", multiLine: true, minLength: 10 } },
            ],
          },
        ],
      },
    ],
    access: [{ to: { group: "Kitchen" }, level: "run" }],
  },
  {
    name: "Fire alarm test",
    description: "Weekly call point test",
    versions: [
      // Superseded, and archived so no new runs can start from it
      {
        status: "archived",
        steps: [{ title: "Test a call point", assignee: { role: "admin" } }],
      },
      {
        status: "published",
        steps: [
          {
            title: "Test a call point",
            assignee: { role: "admin" },
            dueOffset: "P2D",
            fields: [
              { key: "tested_at", label: "Tested at", options: { type: "date", dateType: "datetime", allowFuture: false } },
              {
                key: "zones_tested",
                label: "Zones tested",
                options: {
                  type: "dropdown",
                  choices: [{ value: "north", label: "North wing" }, { value: "south", label: "South wing" }, { value: "plant", label: "Plant room" }],
                  multiple: true,
                },
              },
              { key: "sounders_heard", label: "Sounders heard in every zone", options: { type: "checkbox" } },
            ],
          },
          { title: "Log the test in the fire book", isHalt: true, assignee: { role: "admin" } },
          { title: "Tell the building manager", skippable: true },
        ],
      },
    ],
    access: [{ to: { group: "Maintenance" }, level: "view" }],
  },
  {
    name: "New starter onboarding",
    description: "Not published yet",
    createdBy: "editor",
    versions: [
      {
        status: "draft",
        steps: [
          { title: "Create accounts", fields: [{ key: "email_address", label: "Work email", options: { type: "text", multiLine: false } }] },
          { title: "Issue a laptop", fields: [{ key: "laptop_serial", label: "Serial number", options: { type: "text", multiLine: false } }] },
          { title: "First-day welcome" },
        ],
      },
    ],
  },
  {
    name: "Visitor sign-in",
    description: "Replaced by the reception system",
    status: "archived",
    versions: [
      {
        status: "published",
        steps: [
          {
            title: "Sign the visitor in",
            fields: [
              { key: "visitor_name", label: "Visitor's name", options: { type: "text", multiLine: false } },
              { key: "arrived_on", label: "Date", options: { type: "date", dateType: "date", allowFuture: false } },
            ],
          },
        ],
      },
    ],
  },
]

function resolveAssignee(assignee: SeedAssignee | undefined, organization: SeededOrganization, groups: Record<SeedGroupName, string>): Assignee | null {
  if (!assignee) return null
  if ("member" in assignee) return { type: "member", memberId: organization.members[assignee.member].memberId }
  if ("group" in assignee) return { type: "team", teamId: groups[assignee.group] }
  return { type: "role", role: assignee.role }
}

async function insertTemplate(tx: Transaction, definition: SeedTemplate, organization: SeededOrganization, groups: Record<SeedGroupName, string>) {
  const createdBy = organization.members[definition.createdBy ?? "owner"].userId
  const publishedBy = organization.members.owner.userId

  const [template] = await tx.insert(templates).values({
    organizationId: organization.id,
    name: definition.name,
    description: definition.description ?? null,
    status: definition.status ?? "active",
    createdBy,
  }).returning()

  let currentVersionId: string | null = null
  for (const [index, seedVersion] of definition.versions.entries()) {
    const [version] = await tx.insert(templateVersions).values({
      organizationId: organization.id,
      templateId: template!.id,
      version: index + 1,
      status: seedVersion.status,
      publishedAt: seedVersion.status === "draft" ? null : new Date(),
      publishedBy: seedVersion.status === "draft" ? null : publishedBy,
      createdBy,
    }).returning()
    if (seedVersion.status === "published") currentVersionId = version!.id

    for (const [position, seedStep] of seedVersion.steps.entries()) {
      const [step] = await tx.insert(templateSteps).values({
        organizationId: organization.id,
        templateVersionId: version!.id,
        position,
        title: seedStep.title,
        instructions: seedStep.instructions ?? null,
        kind: seedStep.kind ?? "task",
        isHalt: seedStep.isHalt ?? false,
        skippable: seedStep.skippable ?? false,
        dueOffset: seedStep.dueOffset ?? null,
        createdBy,
        ...assigneeToFlat(resolveAssignee(seedStep.assignee, organization, groups)),
      }).returning()

      const fields = seedStep.fields ?? []
      if (fields.length > 0) {
        await tx.insert(templateFields).values(fields.map((field, fieldPosition) => ({
          organizationId: organization.id,
          templateVersionId: version!.id,
          templateStepId: step!.id,
          position: fieldPosition,
          key: field.key,
          label: field.label,
          helpText: field.helpText ?? null,
          required: field.required ?? true,
          type: field.options.type,
          options: field.options,
          createdBy,
        })))
      }
    }
  }

  if (currentVersionId) {
    await tx.update(templates).set({ currentVersionId }).where(eq(templates.id, template!.id))
  }

  for (const grant of definition.access ?? []) {
    await tx.insert(templateAccess).values({
      organizationId: organization.id,
      templateId: template!.id,
      memberId: "member" in grant.to ? organization.members[grant.to.member].memberId : null,
      teamId: "group" in grant.to ? groups[grant.to.group] : null,
      level: grant.level,
      createdBy: publishedBy,
    })
  }
}

// Seeds each template that the organization doesn't already have, by name, so editing a seeded template isn't undone
export async function seedTemplates(organization: SeededOrganization, groups: Record<SeedGroupName, string>) {
  for (const definition of templateDefinitions) {
    const existing = await db.query.templates.findFirst({
      where: and(eq(templates.organizationId, organization.id), eq(templates.name, definition.name)),
    })
    if (existing) continue

    await db.transaction(tx => insertTemplate(tx, definition, organization, groups))
    logger.info(`Seeded template ${definition.name} in ${organization.name}`)
  }
}
