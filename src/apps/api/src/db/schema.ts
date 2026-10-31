import { pgTable, text, integer, timestamp, unique, uniqueIndex, foreignKey, type PgTableExtraConfigValue } from "drizzle-orm/pg-core"
import { organizations, users } from "./auth-schema.ts"
import { sql } from "drizzle-orm"
import { typeIdForTable } from "../util/typeid.ts"

export const templates = pgTable("templates", {
  id: text("id").primaryKey().$defaultFn(() => typeIdForTable("templates").toString()),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status", { enum: ["active", "archived"] }).notNull(),
  currentVersionId: text("current_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  // Target for the templates.current_version_id foreign key
  unique().on(t.id, t.templateId),
  unique().on(t.templateId, t.version),
  uniqueIndex("template_versions_one_draft_idx").on(t.templateId).where(sql`${t.status} = 'draft'`),
  foreignKey({
    name: "template_versions_template_id_fk",
    columns: [t.templateId, t.organizationId],
    foreignColumns: [templates.id, templates.organizationId],
  }).onDelete("restrict"),
])

// export const templateSteps = pgTable("template_steps")
// export const templateFields = pgTable("template_fields")
// export const templateAccess = pgTable("template_access")

// export const schedules = pgTable("schedules")

// export const runs = pgTable("runs")
// export const runSteps = pgTable("run_steps")
// export const runFieldValues = pgTable("run_field_values")
// export const stepNotes = pgTable("step_notes")
