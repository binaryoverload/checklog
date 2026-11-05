import z from "zod"

export const organizationTypes = ["personal", "managed"] as const
export const organizationTypeSchema = z.enum(organizationTypes)
export type OrganizationType = z.infer<typeof organizationTypeSchema>
