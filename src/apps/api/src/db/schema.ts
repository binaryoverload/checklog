import { pgTable, text, integer, boolean, timestamp, unique, uniqueIndex, foreignKey, type PgTableExtraConfigValue, interval, index, jsonb } from "drizzle-orm/pg-core"
import { members, organizations, teams, users } from "./auth-schema.ts"
import { sql } from "drizzle-orm"
import { typeIdForTable } from "../util/typeid.ts"

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
  status: text("status", { enum: ["active", "archived"] }).notNull(),
  currentVersionId: text("current_version_id"),
  ...createdFields,
  ...updatedFields,

}, (t): PgTableExtraConfigValue[] => [
  // Target for the templateVersions table's foreign key to templates
  unique().on(t.id, t.organizationId),
  uniqueIndex("templates_name_unique_idx").on(t.name, t.organizationId).where(sql`${t.status} = 'active'`),
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
  status: text("status", { enum: ["draft", "published", "archived"] }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: text("published_by").references(() => users.id, { onDelete: "set null" }),
  ...createdFields,
  ...updatedFields,
}, t => [
  // Target for the templates.current_version_id foreign key
  unique().on(t.id, t.templateId),
  unique().on(t.id, t.organizationId),
  unique().on(t.templateId, t.version),
  uniqueIndex("template_versions_one_draft_idx").on(t.templateId).where(sql`${t.status} = 'draft'`),
  foreignKey({
    name: "template_versions_template_id_fk",
    columns: [t.templateId, t.organizationId],
    foreignColumns: [templates.id, templates.organizationId],
  }).onDelete("restrict"),
])

export const templateSteps = pgTable("template_steps", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("templateSteps").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateVersionId: text("template_version_id").notNull(),
  kind: text("kind", { enum: ["task", "approval"] }).notNull().default("task"),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  isHalt: boolean("is_halt").notNull().default(false),
  skippable: boolean("skippable").notNull().default(false),
  assigneeType: text("assignee_type", { enum: ["user", "team", "role"] }),
  assigneeRef: text("assignee_ref"),
  dueOffset: interval("due_offset"),
  ...createdFields,
  ...updatedFields,
}, t => [
  unique().on(t.id, t.templateVersionId, t.organizationId),
  index("template_steps_version_position_idx").on(t.templateVersionId, t.position),
  foreignKey({
    name: "template_steps_template_versions_id_fk",
    columns: [t.templateVersionId, t.organizationId],
    foreignColumns: [templateVersions.id, templateVersions.organizationId],
  }).onDelete("cascade"),
])

export interface TemplateFieldOptions {
  dropdownChoices?: string[]
}

export const templateFields = pgTable("template_fields", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("templateFields").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateVersionId: text("template_version_id").notNull(),
  templateStepId: text("template_step_id").notNull(),
  position: integer("position").notNull(),
  required: boolean("required").notNull().default(true),
  key: text("key").notNull(),
  label: text("label").notNull(),
  type: text("type", { enum: ["text", "date", "dropdown", "checkbox"] }).notNull(),
  options: jsonb("options").$type<TemplateFieldOptions>(),
  ...createdFields,
  ...updatedFields,
}, t => [
  unique().on(t.templateVersionId, t.key), // Unique across the whole version for comparison
  index("template_fields_step_position_idx").on(t.templateStepId, t.position),
  foreignKey({
    name: "template_fields_template_steps_id_fk",
    columns: [t.templateStepId, t.templateVersionId, t.organizationId],
    foreignColumns: [templateSteps.id, templateSteps.templateVersionId, templateSteps.organizationId],
  }).onDelete("cascade"),
])

export const templateAccess = pgTable("template_access", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("templateAccess").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateId: text("template_id").notNull(),
  memberId: text("member_id").references(() => members.id, { onDelete: "cascade" }),
  teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
  level: text("level", { enum: ["view", "run", "edit"] }).notNull().default("view"),
  ...createdFields,
  ...updatedFields,
}, t => [
  unique().on(t.templateId, t.memberId),
  unique().on(t.templateId, t.teamId),
  index("template_access_member_idx").on(t.memberId),
  index("template_access_team_idx").on(t.teamId),
  foreignKey({
    name: "template_access_template_id_fk",
    columns: [t.templateId, t.organizationId],
    foreignColumns: [templates.id, templates.organizationId],
  }).onDelete("cascade"),
])

export const schedules = pgTable("schedules", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("schedules").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateId: text("template_id").notNull(),
  rrule: text("rrule").notNull(),
  timezone: text("timezone").notNull(),
  next_run_at: timestamp("next_run_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  run_name_pattern: text("run_name_pattern").notNull(),
  ...createdFields,
  ...updatedFields,
}, t => [
  foreignKey({
    name: "schedules_template_id_fk",
    columns: [t.templateId, t.organizationId],
    foreignColumns: [templates.id, templates.organizationId],
  }).onDelete("cascade"),
])

// export const runs = pgTable("runs")
// export const runSteps = pgTable("run_steps")
// export const runFieldValues = pgTable("run_field_values")
// export const stepNotes = pgTable("step_notes")

// export const approvalRequests = pgTable("approval_requests")
// export const approvalDecisions = pgTable("approval_decisions")

// export const auditEvents = pgTable("audit_events")

// export const notifications = pgTable("notifications")
