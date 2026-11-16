import z from "zod"

export const requiredString = (message = "Required") => z.string(message).trim().min(1, message)

export const optionalText = (max: number, message: string) =>
  z.string().trim().max(max, message).transform(v => v || null).nullable().optional()
