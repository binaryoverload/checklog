import { sql } from "drizzle-orm"
import { pgTable, text, integer, boolean, timestamp, unique, uniqueIndex, foreignKey, interval, index, jsonb } from "drizzle-orm/pg-core"

import { assigneeTypes, fieldTypes, runStatuses, runStepStatuses, scheduleStatuses, templateAccessLevels, templateStatuses, templateStepKinds, templateVersionStatuses } from "@checklog/shared"

import { members, organizations, teams, users } from "./auth-schema.ts"
import { typeIdForTable } from "../util/typeid.ts"

import type { FieldOptions, FieldValue } from "@checklog/shared"
import type { PgTableExtraConfigValue } from "drizzle-orm/pg-core"

const createdFields = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(), // Deliberately not a foreign key to users
}

const updatedFields = {
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}

export const templates = pgTable("templates", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("templates").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status", { enum: templateStatuses }).notNull().default("active"),
  currentVersionId: text("current_version_id"),
  ...createdFields,
  ...updatedFields,

}, (t): PgTableExtraConfigValue[] => [
  // Target for the templateVersions table's foreign key to templates
  unique().on(t.organizationId, t.id),
  uniqueIndex("templates_name_unique_idx").on(t.organizationId, t.name).where(sql`${t.status} = 'active'`),
  // The current version must be one of this template's own versions.
  foreignKey({
    name: "templates_current_version_id_fk",
    columns: [t.currentVersionId, t.id],
    foreignColumns: [templateVersions.id, templateVersions.templateId],
  }).onDelete("restrict"),
])

export const templateVersions = pgTable("template_versions", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("templateVersions").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateId: text("template_id").notNull(),
  version: integer("version").notNull(),
  status: text("status", { enum: templateVersionStatuses }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: text("published_by").references(() => users.id, { onDelete: "set null" }),
  ...createdFields,
  ...updatedFields,
}, t => [
  // Target for the templates.current_version_id foreign key
  unique().on(t.id, t.templateId),
  unique().on(t.organizationId, t.id),
  unique().on(t.templateId, t.version),
  uniqueIndex("template_versions_one_draft_idx").on(t.templateId).where(sql`${t.status} = 'draft'`),
  foreignKey({
    name: "template_versions_template_id_fk",
    columns: [t.organizationId, t.templateId],
    foreignColumns: [templates.organizationId, templates.id],
  }).onDelete("restrict"),
])

export const templateSteps = pgTable("template_steps", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("templateSteps").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateVersionId: text("template_version_id").notNull(),
  kind: text("kind", { enum: templateStepKinds }).notNull().default("task"),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  isHalt: boolean("is_halt").notNull().default(false),
  skippable: boolean("skippable").notNull().default(false),
  assigneeType: text("assignee_type", { enum: assigneeTypes }),
  assigneeMemberId: text("assignee_member_id").references(() => members.id, { onDelete: "set null" }),
  assigneeTeamId: text("assignee_team_id").references(() => teams.id, { onDelete: "set null" }),
  assigneeRole: text("assignee_role"),
  dueOffset: interval("due_offset"),
  ...createdFields,
  ...updatedFields,
}, t => [
  unique().on(t.organizationId, t.id, t.templateVersionId),
  index("template_steps_version_position_idx").on(t.templateVersionId, t.position),
  foreignKey({
    name: "template_steps_template_versions_id_fk",
    columns: [t.organizationId, t.templateVersionId],
    foreignColumns: [templateVersions.organizationId, templateVersions.id],
  }).onDelete("cascade"),
])

export const templateFields = pgTable("template_fields", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("templateFields").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateVersionId: text("template_version_id").notNull(),
  templateStepId: text("template_step_id").notNull(),
  position: integer("position").notNull(),
  required: boolean("required").notNull().default(true),
  key: text("key").notNull(),
  label: text("label").notNull(),
  helpText: text("help_text"),
  type: text("type", { enum: fieldTypes }).notNull(),
  options: jsonb("options").$type<FieldOptions>().notNull(),
  ...createdFields,
  ...updatedFields,
}, t => [
  unique().on(t.organizationId, t.id),
  unique().on(t.templateVersionId, t.key), // Unique across the whole version for comparison
  index("template_fields_step_position_idx").on(t.templateStepId, t.position),
  foreignKey({
    name: "template_fields_template_steps_id_fk",
    columns: [t.organizationId, t.templateStepId, t.templateVersionId],
    foreignColumns: [templateSteps.organizationId, templateSteps.id, templateSteps.templateVersionId],
  }).onDelete("cascade"),
])

export const templateAccess = pgTable("template_access", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("templateAccess").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateId: text("template_id").notNull(),
  memberId: text("member_id").references(() => members.id, { onDelete: "cascade" }),
  teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
  level: text("level", { enum: templateAccessLevels }).notNull().default("view"),
  ...createdFields,
  ...updatedFields,
}, t => [
  unique().on(t.templateId, t.memberId),
  unique().on(t.templateId, t.teamId),
  index("template_access_member_idx").on(t.memberId),
  index("template_access_team_idx").on(t.teamId),
  foreignKey({
    name: "template_access_template_id_fk",
    columns: [t.organizationId, t.templateId],
    foreignColumns: [templates.organizationId, templates.id],
  }).onDelete("cascade"),
])

export const schedules = pgTable("schedules", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("schedules").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateId: text("template_id").notNull(),
  status: text("status", { enum: scheduleStatuses }).notNull().default("active"),
  rrule: text("rrule").notNull(),
  timezone: text("timezone").notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  runNamePattern: text("run_name_pattern").notNull(),
  ...createdFields,
  ...updatedFields,
}, t => [
  unique().on(t.organizationId, t.id),
  index("schedules_due_idx").on(t.nextRunAt),
  foreignKey({
    name: "schedules_template_id_fk",
    columns: [t.organizationId, t.templateId],
    foreignColumns: [templates.organizationId, templates.id],
  }).onDelete("cascade"),
])

export const runs = pgTable("runs", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("runs").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateVersionId: text("template_version_id").notNull(),
  scheduleId: text("schedule_id"),
  name: text("name").notNull(),
  status: text("status", { enum: runStatuses }).notNull().default("in_progress"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...createdFields,
  ...updatedFields,
}, t => [
  unique().on(t.organizationId, t.id),
  unique().on(t.organizationId, t.id, t.templateVersionId),
  index("runs_organization_status_idx").on(t.organizationId, t.status),
  index("runs_template_version_idx").on(t.templateVersionId),
  index("runs_schedule_idx").on(t.scheduleId),
  foreignKey({
    name: "runs_template_version_id_fk",
    columns: [t.organizationId, t.templateVersionId],
    foreignColumns: [templateVersions.organizationId, templateVersions.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "runs_schedule_id_fk",
    columns: [t.organizationId, t.scheduleId],
    foreignColumns: [schedules.organizationId, schedules.id],
  }).onDelete("restrict"),
])

export const runSteps = pgTable("run_steps", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("runSteps").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  templateVersionId: text("template_version_id").notNull(),
  templateStepId: text("template_step_id").notNull(),
  status: text("status", { enum: runStepStatuses }).notNull().default("pending"),
  assigneeType: text("assignee_type", { enum: assigneeTypes }),
  assigneeMemberId: text("assignee_member_id").references(() => members.id, { onDelete: "set null" }),
  assigneeTeamId: text("assignee_team_id").references(() => teams.id, { onDelete: "set null" }),
  assigneeRole: text("assignee_role"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: text("completed_by"),
  skipReason: text("skip_reason"),
  ...createdFields,
  ...updatedFields,
}, t => [
  unique().on(t.organizationId, t.id),
  unique().on(t.runId, t.templateStepId), // Only one step per run per template step
  index("run_steps_template_step_id_idx").on(t.templateStepId),
  index("run_steps_assignee_member_id_idx").on(t.assigneeMemberId),
  index("run_steps_assignee_team_id_idx").on(t.assigneeTeamId),
  foreignKey({
    name: "run_steps_run_id_fk",
    columns: [t.organizationId, t.runId, t.templateVersionId],
    foreignColumns: [runs.organizationId, runs.id, runs.templateVersionId],
  }).onDelete("cascade"),
  foreignKey({
    name: "run_steps_template_step_id_fk",
    columns: [t.organizationId, t.templateStepId, t.templateVersionId],
    foreignColumns: [templateSteps.organizationId, templateSteps.id, templateSteps.templateVersionId],
  }).onDelete("restrict"),
])

export const runFieldValues = pgTable("run_field_values", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("runFieldValues").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  runStepId: text("run_step_id").notNull(),
  templateFieldId: text("template_field_id").notNull(),
  value: jsonb("value").$type<FieldValue>(),
  ...createdFields,
  ...updatedFields,
  updatedBy: text("updated_by"),
}, t => [
  unique().on(t.runStepId, t.templateFieldId), // Only one value per run step per template field
  index("run_field_values_template_field_id_idx").on(t.templateFieldId),
  foreignKey({
    name: "run_field_values_run_step_id_fk",
    columns: [t.organizationId, t.runStepId],
    foreignColumns: [runSteps.organizationId, runSteps.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "run_field_values_template_field_id_fk",
    columns: [t.organizationId, t.templateFieldId],
    foreignColumns: [templateFields.organizationId, templateFields.id],
  }).onDelete("restrict"),
])

export const stepNotes = pgTable("step_notes", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("stepNotes").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  runStepId: text("run_step_id").notNull(),
  body: text("body").notNull(),
  ...createdFields,
}, t => [
  index("step_notes_run_step_id_idx").on(t.runStepId),
  foreignKey({
    name: "step_notes_run_step_id_fk",
    columns: [t.organizationId, t.runStepId],
    foreignColumns: [runSteps.organizationId, runSteps.id],
  }).onDelete("cascade"),
])

// export const approvalRequests = pgTable("approval_requests")
// export const approvalDecisions = pgTable("approval_decisions")

// export const auditEvents = pgTable("audit_events")

// export const notifications = pgTable("notifications")
