import z from "zod"

export const requiredString = (message = "Required") => z.string(message).min(1, message)
