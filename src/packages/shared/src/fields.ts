import z from "zod"
import { dateTypeSchema, type FieldType } from "./enums"

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
    pattern: z.string().optional(),
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
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
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

type _OptionTypesCovered = Exclude<FieldType, FieldOptions["type"]> extends never ? true : never
// If this failed type checking, it means not all FieldTypes are covered in FieldOption["type"]
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _optionTypesCovered: _OptionTypesCovered = true

export const fieldValueSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    value: z.string(),
  }),
  z.object({
    type: z.literal("number"),
    value: z.number(),
  }),
  z.object({
    type: z.literal("date"),
    dateType: dateTypeSchema,
    value: z.string(),
  }),
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

type _ValueTypesCovered = Exclude<FieldType, FieldValue["type"]> extends never ? true : never
// If this failed type checking, it means not all FieldTypes are covered in FieldValue["type"]
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _valueTypesCovered: _ValueTypesCovered = true
