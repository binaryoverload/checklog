import z from "zod"

export const paginationQuerySchema = (limit: number = 100, defaultLimit: number = limit) => z.object({
  limit: z.coerce.number().int().min(1).max(limit).default(defaultLimit),
  cursor: z.string().optional(),
})

export interface Paginated<T> {
  items: T[]
  nextCursor: string | null
  total: number
}
