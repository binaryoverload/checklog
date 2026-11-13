import z from "zod"

export const fieldTypes = ["text", "number", "date", "dropdown", "checkbox"] as const
export const fieldTypeSchema = z.enum(fieldTypes)
export type FieldType = z.infer<typeof fieldTypeSchema>

export const dateTypes = ["date", "datetime", "time"] as const
export const dateTypeSchema = z.enum(dateTypes)
export type DateType = z.infer<typeof dateTypeSchema>

export const fieldOptionsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dropdown"),
    choices: z.array(z.object({
      value: z.string(),
      label: z.string(),
    })),
    multiple: z.boolean(),
  }),
  z.object({
    type: z.literal("text"),
    multiLine: z.boolean(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string()
      .refine((v) => {
        try {
          new RegExp(v)
          return true
        } catch { return false }
      }, "Invalid regex")
      .optional(),
  }).superRefine((data, ctx) => {
    if (data.minLength !== undefined && data.maxLength !== undefined && data.minLength > data.maxLength) {
      ctx.addIssue({
        code: "custom",
        message: "minLength cannot be greater than maxLength",
        path: ["minLength"],
      })
    }
  }),
  z.object({
    type: z.literal("number"),
    decimalPlaces: z.number().int().nonnegative().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.string().optional(),
  }).superRefine((data, ctx) => {
    if (data.min !== undefined && data.max !== undefined && data.min > data.max) {
      ctx.addIssue({
        code: "custom",
        message: "min cannot be greater than max",
        path: ["min"],
      })
    }
  }),
  z.object({
    type: z.literal("date"),
    dateType: dateTypeSchema,
    allowFuture: z.boolean(),
  }),
  z.object({
    type: z.literal("checkbox"),
  }),
])

export type FieldOptions = z.infer<typeof fieldOptionsSchema>

export const fieldValueSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    value: z.string(),
  }),
  z.object({
    type: z.literal("number"),
    value: z.number(),
  }),
  z.discriminatedUnion("dateType", [
    z.object({
      type: z.literal("date"),
      dateType: z.literal("date"),
      value: z.iso.date(),
    }),
    z.object({
      type: z.literal("date"),
      dateType: z.literal("datetime"),
      value: z.iso.datetime({ offset: true }),
    }),
    z.object({
      type: z.literal("date"),
      dateType: z.literal("time"),
      value: z.iso.time(),
    }),
  ]),

  z.object({
    type: z.literal("checkbox"),
    value: z.boolean(),
  }),
  z.object({
    type: z.literal("dropdown"),
    values: z.array(z.string()),
  }),
])

export type FieldValue = z.infer<typeof fieldValueSchema>

export type FieldValueIssue = {
  path: string[]
  message: string
}

export function validateFieldValue(options: FieldOptions, value: FieldValue | null, now: { date: string, datetime: Date }): FieldValueIssue[] {
  const issues: FieldValueIssue[] = []
  if (value == null) return issues

  const incorrectType = () => {
    issues.push({ path: ["type"], message: "Type mismatch" })
    return issues
  }

  const issue = (path: string, message: string) => {
    issues.push({ path: [path], message })
  }

  switch (options.type) {
    case "checkbox":
      if (value.type !== "checkbox") return incorrectType()
      return issues
    case "dropdown":
      if (value.type !== "dropdown") return incorrectType()
      if (!options.multiple && value.values.length > 1) issue("values", "Too many choices selected")
      if (value.values.some(v => !options.choices.map(c => c.value).includes(v))) issue("values", "Invalid choice")
      return issues
    case "text":
      if (value.type !== "text") return incorrectType()
      if (!options.multiLine && value.value.includes("\n")) issue("value", "Multiline not allowed")
      if (options.maxLength != null && value.value.length > options.maxLength) issue("value", `Text must have at most ${options.maxLength} characters`)
      if (options.minLength != null && value.value.length < options.minLength) issue("value", `Text must have at least ${options.minLength} characters`)
      if (options.pattern && !RegExp(`^(?:${options.pattern})$`).test(value.value)) issue("value", "Invalid format")
      return issues
    case "number":
      if (value.type !== "number") return incorrectType()
      if (options.min != null && value.value < options.min) issue("value", `Value must be >= ${options.min}`)
      if (options.max != null && value.value > options.max) issue("value", `Value must be <= ${options.max}`)
      if (options.decimalPlaces !== undefined && Number(value.value.toFixed(options.decimalPlaces)) !== value.value) {
        issue("value", `Value must have at most ${options.decimalPlaces} decimal places`)
      }
      return issues
    case "date":
      if (value.type !== "date") return incorrectType()
      if (options.dateType !== value.dateType) issue("dateType", "Incorrect date type")
      if (options.dateType === "date" && options.allowFuture === false && value.value > now.date) issue("value", "Future dates not allowed")
      if (options.dateType === "datetime" && options.allowFuture === false && new Date(value.value) > now.datetime) issue("value", "Future dates not allowed")
      return issues
    default:
      options satisfies never
      return issues
  }
}
