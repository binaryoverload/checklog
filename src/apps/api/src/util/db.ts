import { DrizzleQueryError } from "drizzle-orm"
import { DatabaseError } from "pg"

// https://www.postgresql.org/docs/current/errcodes-appendix.html
const postgresErrorCodes = {
  restrictViolation: "23001",
  foreignKeyViolation: "23503",
  uniqueViolation: "23505",
}

export type PGWrappedError = DrizzleQueryError & { cause: DatabaseError }

export const isPgError = (error: unknown): error is PGWrappedError => {
  return (error instanceof DrizzleQueryError && error.cause instanceof DatabaseError)
}

export function isForeignKeyViolation(error: unknown): boolean {
  return isPgError(error) && error.cause.code === postgresErrorCodes.foreignKeyViolation
}

export function isRestrictViolation(error: unknown): boolean {
  return isPgError(error) && error.cause.code === postgresErrorCodes.restrictViolation
}

export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
  const isUnique = isPgError(error) && error.cause.code === postgresErrorCodes.uniqueViolation
  if (constraintName) {
    return isUnique && error.cause.constraint != null && error.cause.constraint.includes(constraintName)
  }
  return isUnique
}
