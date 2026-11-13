import { DateTime, Duration, IANAZone } from "luxon"

export function addOffset(start: Date, offset: string, zone: IANAZone<true>): Date {
  return DateTime.fromJSDate(start, { zone }).plus(Duration.fromISO(offset)).toJSDate()
}

export function dateInTimezone(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone }).toISODate()!
}

export function canonicalTimezone(zone: string): string {
  if (!IANAZone.isValidZone(zone)) throw new Error("Invalid timezone")
  const canonical = Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone
  // Fixed offsets such as +01:00 are valid zones to Luxon and Intl, but aren't IANA names and have no daylight saving
  if (/^[+-]/.test(canonical)) throw new Error("Invalid timezone")
  return canonical
}
