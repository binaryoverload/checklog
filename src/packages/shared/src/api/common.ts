import z from "zod"

export type CreatedFields = {
  createdAt: string
  createdBy: string
}

export type UpdatedFields = {
  updatedAt: string
}

export const sortOrderSchema = z.enum(["asc", "desc"])
export type SortOrder = z.infer<typeof sortOrderSchema>
