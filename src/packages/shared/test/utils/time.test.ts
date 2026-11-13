import { IANAZone } from "luxon"
import { describe, expect, test } from "vitest"

import { addOffset, canonicalTimezone, dateInTimezone, isValidTimezone } from "@checklog/shared/utils"

// Europe/London's 2026 changes: the clocks go forward at 01:00 GMT on 29 March, and back at 02:00 BST on 25 October.
// Instants are written in UTC, with the London wall-clock time in the test name.
const at = (iso: string) => new Date(iso)

// addOffset takes a zone already known to be valid
function zone(name: string): IANAZone<true> {
  const created = IANAZone.create(name)
  if (!created.isValid) throw new Error(`Invalid zone in a test: ${name}`)
  return created
}

const london = zone("Europe/London")

describe("addOffset", () => {
  test.each([
    ["P1D across the clocks going back keeps the clock time", "2026-10-24T08:00:00Z", "P1D", "2026-10-25T09:00:00Z"],
    ["PT24H across the clocks going back is exact elapsed time", "2026-10-24T08:00:00Z", "PT24H", "2026-10-25T08:00:00Z"],
    ["P1DT2H adds the day first, then the hours", "2026-10-24T08:00:00Z", "P1DT2H", "2026-10-25T11:00:00Z"],
    ["P1D across the clocks going forward keeps the clock time", "2026-03-28T09:00:00Z", "P1D", "2026-03-29T08:00:00Z"],
    ["PT24H across the clocks going forward is exact elapsed time", "2026-03-28T09:00:00Z", "PT24H", "2026-03-29T09:00:00Z"],
    ["P1W keeps the clock time across a change", "2026-10-20T08:00:00Z", "P1W", "2026-10-27T09:00:00Z"],
  ])("in Europe/London, %s", (_description, start, offset, expected) => {
    expect(addOffset(at(start), offset, london)).toEqual(at(expected))
  })

  test("in Europe/London, a calendar offset landing in the spring gap moves forward by the gap", () => {
    // 28 March 01:30 GMT plus a day is 29 March 01:30, which doesn't exist, so it becomes 02:30 BST
    expect(addOffset(at("2026-03-28T01:30:00Z"), "P1D", london)).toEqual(at("2026-03-29T01:30:00Z"))
  })

  test("in Europe/London, a calendar offset landing in the autumn overlap gives the first occurrence", () => {
    // 24 October 01:30 BST plus a day is 25 October 01:30, which happens twice; adding keeps BST, the first
    expect(addOffset(at("2026-10-24T00:30:00Z"), "P1D", london)).toEqual(at("2026-10-25T00:30:00Z"))
  })

  test("in another zone, uses that zone's changes rather than London's", () => {
    // New York's clocks go back on 1 November 2026: 09:00 EDT plus a day is 09:00 EST
    expect(addOffset(at("2026-10-31T13:00:00Z"), "P1D", zone("America/New_York"))).toEqual(at("2026-11-01T14:00:00Z"))
  })

  test("in UTC, a day is always 24 hours", () => {
    expect(addOffset(at("2026-10-24T08:00:00Z"), "P1D", zone("UTC"))).toEqual(at("2026-10-25T08:00:00Z"))
  })

  test.each([
    ["PT4H", "2026-11-06T13:00:00Z"],
    ["P3D", "2026-11-09T09:00:00Z"],
    ["PT36H", "2026-11-07T21:00:00Z"],
    ["PT90M", "2026-11-06T10:30:00Z"],
  ])("adds %s outside any clock change", (offset, expected) => {
    expect(addOffset(at("2026-11-06T09:00:00Z"), offset, london)).toEqual(at(expected))
  })

  test("adding a month to the end of a month gives the last day of the next month", () => {
    expect(addOffset(at("2026-01-31T09:00:00Z"), "P1M", zone("UTC"))).toEqual(at("2026-02-28T09:00:00Z"))
  })

  test("doesn't change the start date it's given", () => {
    const start = at("2026-11-06T09:00:00Z")

    addOffset(start, "P1D", london)

    expect(start).toEqual(at("2026-11-06T09:00:00Z"))
  })
})

describe("dateInTimezone", () => {
  test.each([
    ["Europe/London in winter, where it's the same as UTC", "2026-11-06T23:30:00Z", "Europe/London", "2026-11-06"],
    ["Europe/London in summer, an hour ahead of UTC", "2026-07-01T23:30:00Z", "Europe/London", "2026-07-02"],
    ["a zone ahead of UTC", "2026-11-06T23:30:00Z", "Pacific/Auckland", "2026-11-07"],
    ["a zone behind UTC", "2026-11-07T07:30:00Z", "America/Los_Angeles", "2026-11-06"],
    ["the furthest zone ahead, UTC+14", "2026-11-06T10:30:00Z", "Pacific/Kiritimati", "2026-11-07"],
    ["the furthest zone behind, UTC−12", "2026-11-06T11:30:00Z", "Etc/GMT+12", "2026-11-05"],
    ["UTC", "2026-11-06T23:59:59Z", "UTC", "2026-11-06"],
  ])("gives the date in %s", (_description, date, zone, expected) => {
    expect(dateInTimezone(at(date), zone)).toBe(expected)
  })
})

describe("isValidTimezone", () => {
  test.each([
    ["a canonical IANA name", "Europe/London"],
    ["a name in the wrong case", "europe/london"],
    ["UTC", "UTC"],
    ["an older alias", "US/Eastern"],
    ["an Etc zone with a fixed offset in its name", "Etc/GMT+1"],
  ])("accepts %s", (_description, zone) => {
    expect(isValidTimezone(zone)).toBe(true)
  })

  test.each([
    ["a name that isn't a zone", "Mars/Olympus_Mons"],
    ["an empty string", ""],
    ["a name with surrounding spaces", " Europe/London "],
    ["a fixed offset with a colon", "+01:00"],
    ["a negative fixed offset", "-05:00"],
    ["a fixed offset without a colon", "+0100"],
    ["an offset written after UTC", "UTC+1"],
  ])("refuses %s", (_description, zone) => {
    expect(isValidTimezone(zone)).toBe(false)
  })
})

describe("canonicalTimezone", () => {
  test.each([
    ["a canonical name as it is", "Europe/London", "Europe/London"],
    ["a name in the wrong case", "europe/london", "Europe/London"],
    ["UTC as it is", "UTC", "UTC"],
    ["Etc/UTC as UTC", "Etc/UTC", "UTC"],
  ])("returns %s", (_description, zone, expected) => {
    expect(canonicalTimezone(zone)).toBe(expected)
  })

  test.each([
    ["a name that isn't a zone", "Mars/Olympus_Mons"],
    ["an empty string", ""],
    ["a fixed offset rather than a zone name", "+01:00"],
  ])("throws for %s", (_description, zone) => {
    expect(() => canonicalTimezone(zone)).toThrow()
  })
})
