import z from "zod"

export const pageQuerySchema = (limit: number = 100, defaultLimit: number = limit) => z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(limit).default(defaultLimit),
})

export const cursorQuerySchema = (limit: number = 100, defaultLimit: number = limit) => z.object({
  limit: z.coerce.number().int().min(1).max(limit).default(defaultLimit),
  cursor: z.string().optional(),
})

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  limit: number
}

export interface CursorResult<T> {
  items: T[]
  nextCursor: string | null
}
