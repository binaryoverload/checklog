import { DateTime, Duration, IANAZone } from "luxon"

export function addOffset(start: Date, offset: string, zone: IANAZone<true>): Date {
  return DateTime.fromJSDate(start, { zone }).plus(Duration.fromISO(offset)).toJSDate()
}

export function dateInTimezone(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone }).toISODate()!
}

/**
 * Checks if a timezone is a valid IANA zone and not a fixed offset
 * @param zone The timezone to check
 * @returns True if valid IANA zone, false otherwise
 */
export function isValidTimezone(zone: string): boolean {
  return IANAZone.isValidZone(zone)
    // Fixed offsets such as +01:00 are valid zones to Luxon and Intl, but aren't IANA names and have no daylight saving
    && !/^[+-]/.test(zone)
}

export function canonicalTimezone(zone: string): string {
  if (!isValidTimezone(zone)) throw new Error("Invalid timezone")
  const canonical = Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone
  return canonical
}
