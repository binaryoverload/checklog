import { and, asc, eq, gt, inArray } from "drizzle-orm"
import { IANAZone } from "luxon"

import { logger } from "@/core/logger.ts"
import { db } from "@/db/index.ts"
import { approvalDecisions, approvalRequests, runFieldValues, runs, runSteps, stepNotes, templateFields, templates, templateSteps } from "@/db/schema.ts"
import type { SeededOrganization } from "@/seed/accounts.ts"
import { completeRunIfResolved, createReachedApprovalRequests, startRun } from "@/services/runs.ts"
import type { Run, Transaction } from "@/util/types.ts"
import type { OrgRole } from "@checklog/shared/auth"
import { fieldValueSchema, validateFieldValue } from "@checklog/shared/domain"
import type { ApprovalDecisionStatus, FieldValue } from "@checklog/shared/domain"
import { addOffset, dateInTimezone } from "@checklog/shared/utils"

// What happened to one step of a seeded run, matched to the template's steps by position. Seeded members act by role
interface SeedRunStep {
  values?: Record<string, FieldValue>
  notes?: { by: OrgRole, body: string }[]
  completedBy?: OrgRole
  skipped?: { by: OrgRole, reason: string }
  // An approval step's decisions, oldest first. An approval completes the step
  decisions?: { by: OrgRole, decision: ApprovalDecisionStatus, comment?: string }[]
}

interface SeedRun {
  template: string
  name: string
  startedBy: OrgRole
  // Backdated so the runs list has a spread of start times; 0 is a few hours ago
  startedDaysAgo: number
  // Completed runs must resolve every step; cancelled runs stop wherever their steps leave off
  status: "in_progress" | "completed" | "cancelled"
  steps: SeedRunStep[]
}

function validZone(name: string): IANAZone<true> {
  const zone = IANAZone.create(name)
  if (!zone.isValid) throw new Error(`${name} isn't a time zone`)
  return zone
}

const timezone = validZone("Europe/London")

export const runDefinitions: SeedRun[] = [
  {
    template: "Weekly server checks",
    name: "Server checks, week 45",
    startedBy: "editor",
    startedDaysAgo: 15,
    status: "completed",
    steps: [
      { completedBy: "editor", values: { free_disk_gb: { type: "number", value: 64.0 }, backups_ran: { type: "checkbox", value: true } } },
      { completedBy: "editor", values: { log_notes: { type: "text", value: "Nothing unusual." } } },
      { skipped: { by: "editor", reason: "Nothing needed restarting" } },
      { decisions: [{ by: "admin", decision: "approved" }] },
    ],
  },
  {
    // Rejected once, so it's back with the approver
    template: "Weekly server checks",
    name: "Server checks, week 46",
    startedBy: "editor",
    startedDaysAgo: 8,
    status: "in_progress",
    steps: [
      {
        completedBy: "editor",
        values: { free_disk_gb: { type: "number", value: 12.5 }, backups_ran: { type: "checkbox", value: false } },
        notes: [{ by: "editor", body: "Backups failed on db-2. I've raised a ticket with the hosting provider." }],
      },
      { completedBy: "editor", values: { log_notes: { type: "text", value: "Disk space alerts on db-2 since Tuesday." } } },
      { skipped: { by: "editor", reason: "Nothing needed restarting" } },
      { decisions: [{ by: "admin", decision: "rejected", comment: "Backups failed and db-2 is under 20 GB. Rerun the backups and check the disk again." }] },
    ],
  },
  {
    // Every task done, so the sign-off waits on its first decision
    template: "Weekly server checks",
    name: "Server checks, week 47",
    startedBy: "editor",
    startedDaysAgo: 1,
    status: "in_progress",
    steps: [
      { completedBy: "editor", values: { free_disk_gb: { type: "number", value: 41.8 }, backups_ran: { type: "checkbox", value: true } } },
      { completedBy: "viewer", values: { log_notes: { type: "text", value: "A few timeouts from the payments API overnight." } } },
      { completedBy: "editor", notes: [{ by: "editor", body: "Restarted the queue worker after the timeouts." }] },
    ],
  },
  {
    template: "Weekly server checks",
    name: "Server checks, week 48",
    startedBy: "owner",
    startedDaysAgo: 0,
    status: "in_progress",
    steps: [
      { completedBy: "editor", values: { free_disk_gb: { type: "number", value: 39.2 } } },
      { notes: [{ by: "viewer", body: "I'll look at the logs after the deploy this afternoon." }] },
    ],
  },
  {
    template: "Fridge temperature log",
    name: "Fridge check, morning",
    startedBy: "viewer",
    startedDaysAgo: 0,
    status: "completed",
    steps: [
      {
        completedBy: "viewer",
        values: {
          fridge_1_temp: { type: "number", value: 3.5 },
          fridge_2_temp: { type: "number", value: 4.1 },
          door_seals: { type: "dropdown", values: ["good"] },
          checked_at: { type: "date", dateType: "time", value: "08:15" },
        },
      },
      { skipped: { by: "viewer", reason: "Both fridges in range" } },
    ],
  },
  {
    template: "Fridge temperature log",
    name: "Fridge check, evening",
    startedBy: "viewer",
    startedDaysAgo: 0,
    status: "in_progress",
    steps: [],
  },
  {
    template: "Fire alarm test",
    name: "Fire alarm test, week 46",
    startedBy: "admin",
    startedDaysAgo: 9,
    status: "cancelled",
    steps: [
      { notes: [{ by: "admin", body: "Abandoned: the panel was in maintenance mode all week." }] },
    ],
  },
  {
    // The halt step is still open, so the step after it is blocked
    template: "Fire alarm test",
    name: "Fire alarm test, week 47",
    startedBy: "admin",
    startedDaysAgo: 2,
    status: "in_progress",
    steps: [
      {
        completedBy: "admin",
        values: {
          tested_at: { type: "date", dateType: "datetime", value: "" },
          zones_tested: { type: "dropdown", values: ["north", "plant"] },
          sounders_heard: { type: "checkbox", value: true },
        },
      },
    ],
  },
]

const minutes = (count: number) => count * 60_000
const hours = (count: number) => minutes(count * 60)

// A datetime value left empty in a definition is set to when its step was done, so it's never in the future
function withTimes(values: Record<string, FieldValue>, at: Date): Record<string, FieldValue> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    value.type === "date" && value.dateType === "datetime" && value.value === "" ? { ...value, value: at.toISOString() } : value,
  ]))
}

async function insertRun(tx: Transaction, definition: SeedRun, organization: SeededOrganization) {
  const memberOf = (role: OrgRole) => organization.members[role].userId

  const [template] = await tx.select().from(templates)
    .where(and(eq(templates.organizationId, organization.id), eq(templates.name, definition.template)))
  if (!template?.currentVersionId) throw new Error(`Seed run ${definition.name} needs the published template ${definition.template}`)

  const started = await startRun(tx, {
    template,
    createdBy: memberOf(definition.startedBy),
    timezone,
    name: definition.name,
    scheduleId: null,
    scheduledFor: null,
  })

  // Backdate the run, and work its due dates out again from the new start
  const startedAt = new Date(Date.now() - (definition.startedDaysAgo === 0 ? hours(3) : definition.startedDaysAgo * hours(24)))
  const [run] = await tx.update(runs).set({ createdAt: startedAt, updatedAt: startedAt }).where(eq(runs.id, started.id)).returning()
  let current: Run = run!

  const steps = await tx.select({ step: runSteps, templateStep: templateSteps }).from(runSteps)
    .innerJoin(templateSteps, eq(templateSteps.id, runSteps.templateStepId))
    .where(eq(runSteps.runId, current.id))
    .orderBy(asc(templateSteps.position))

  for (const { step, templateStep } of steps) {
    const dueAt = templateStep.dueOffset ? addOffset(startedAt, templateStep.dueOffset, timezone) : null
    await tx.update(runSteps).set({ dueAt, createdAt: startedAt, updatedAt: startedAt }).where(eq(runSteps.id, step.id))
  }

  let at = startedAt.getTime()
  const nextMoment = () => new Date(at += minutes(25))

  // Makes any approval requests now due, dated at the seeded moment rather than today
  const reachApprovals = async () => {
    await createReachedApprovalRequests(tx, current, memberOf(definition.startedBy))
    const reachedAt = nextMoment()
    await tx.update(approvalRequests).set({ createdAt: reachedAt, updatedAt: reachedAt }).where(and(
      inArray(approvalRequests.runStepId, steps.map(({ step }) => step.id)),
      gt(approvalRequests.createdAt, reachedAt),
    ))
  }

  for (const [index, seedStep] of definition.steps.entries()) {
    const row = steps[index]
    if (!row) throw new Error(`Seed run ${definition.name} has more steps than ${definition.template}`)
    const { step, templateStep } = row

    for (const note of seedStep.notes ?? []) {
      const createdAt = nextMoment()
      await tx.insert(stepNotes).values({ organizationId: organization.id, runStepId: step.id, body: note.body, createdBy: memberOf(note.by), createdAt })
    }

    const by = seedStep.completedBy ?? seedStep.skipped?.by ?? definition.startedBy
    const fields = await tx.select().from(templateFields).where(eq(templateFields.templateStepId, templateStep.id))
    for (const [key, given] of Object.entries(seedStep.values ?? {})) {
      const field = fields.find(one => one.key === key)
      if (!field) throw new Error(`Seed run ${definition.name}: ${templateStep.title} has no field ${key}`)

      const valueAt = nextMoment()
      const value = fieldValueSchema.parse(withTimes({ [key]: given }, valueAt)[key])
      const issues = validateFieldValue(field.options, value, { date: dateInTimezone(valueAt, timezone.name), datetime: valueAt })
      if (issues.length > 0) throw new Error(`Seed run ${definition.name}: ${key} is invalid: ${issues.map(issue => issue.message).join(", ")}`)

      await tx.insert(runFieldValues).values({
        organizationId: organization.id,
        runStepId: step.id,
        templateFieldId: field.id,
        value,
        createdBy: memberOf(by),
        updatedBy: memberOf(by),
        createdAt: valueAt,
        updatedAt: valueAt,
      })
    }

    if (seedStep.completedBy) {
      const completedAt = nextMoment()
      await tx.update(runSteps).set({ status: "completed", completedBy: memberOf(seedStep.completedBy), completedAt, updatedAt: completedAt }).where(eq(runSteps.id, step.id))
    }
    if (seedStep.skipped) {
      const completedAt = nextMoment()
      await tx.update(runSteps)
        .set({ status: "skipped", skipReason: seedStep.skipped.reason, completedBy: memberOf(seedStep.skipped.by), completedAt, updatedAt: completedAt })
        .where(eq(runSteps.id, step.id))
    }

    // Requests are only made once every earlier step is resolved, so make any that are due before deciding this one
    await reachApprovals()

    if (seedStep.decisions?.length) {
      const [request] = await tx.select().from(approvalRequests).where(eq(approvalRequests.runStepId, step.id))
      if (!request) throw new Error(`Seed run ${definition.name}: ${templateStep.title} isn't an approval step that has been reached`)

      for (const decision of seedStep.decisions) {
        const decidedAt = nextMoment()
        await tx.insert(approvalDecisions).values({
          organizationId: organization.id,
          approvalRequestId: request.id,
          decision: decision.decision,
          comment: decision.comment ?? null,
          createdBy: memberOf(decision.by),
          createdAt: decidedAt,
        })
        await tx.update(approvalRequests).set({ status: decision.decision, updatedAt: decidedAt }).where(eq(approvalRequests.id, request.id))
        if (decision.decision === "approved") {
          await tx.update(runSteps).set({ status: "completed", completedBy: memberOf(decision.by), completedAt: decidedAt, updatedAt: decidedAt }).where(eq(runSteps.id, step.id))
        }
      }
    }
  }

  await reachApprovals()

  if (definition.status === "completed") {
    current = await completeRunIfResolved(tx, current)
    if (current.status !== "completed") throw new Error(`Seed run ${definition.name} is marked completed but has unresolved steps`)
    const completedAt = nextMoment()
    await tx.update(runs).set({ completedAt, updatedAt: completedAt }).where(eq(runs.id, current.id))
  }
  if (definition.status === "cancelled") {
    await tx.update(runs).set({ status: "cancelled", updatedAt: nextMoment() }).where(eq(runs.id, current.id))
  }
}

// Seeds each run the organization doesn't already have, by name, so working through a seeded run isn't undone
export async function seedRuns(organization: SeededOrganization) {
  for (const definition of runDefinitions) {
    const existing = await db.query.runs.findFirst({
      where: and(eq(runs.organizationId, organization.id), eq(runs.name, definition.name)),
    })
    if (existing) continue

    await db.transaction(tx => insertRun(tx, definition, organization))
    logger.info(`Seeded run ${definition.name} in ${organization.name}`)
  }
}
