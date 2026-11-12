import { describe, expect, test } from "vitest"

import { blockedStepIds } from "@checklog/shared/domain"
import type { RunStepStatus } from "@checklog/shared/domain"

// Steps in template order, named a, b, c… so the expected sets read easily
function steps(...specs: [isHalt: boolean, status: RunStepStatus][]) {
  return specs.map(([isHalt, status], index) => ({ id: String.fromCharCode(97 + index), isHalt, status }))
}

describe("blockedStepIds", () => {
  test("blocks nothing when there are no halt steps", () => {
    expect(blockedStepIds(steps([false, "pending"], [false, "pending"]))).toEqual(new Set())
  })

  test("blocks every step after a pending halt step, but not the halt step itself", () => {
    expect(blockedStepIds(steps([false, "pending"], [true, "pending"], [false, "pending"], [false, "completed"]))).toEqual(new Set(["c", "d"]))
  })

  test("blocks nothing after a completed halt step", () => {
    expect(blockedStepIds(steps([true, "completed"], [false, "pending"]))).toEqual(new Set())
  })

  test("doesn't treat a skipped halt step as pending", () => {
    expect(blockedStepIds(steps([true, "skipped"], [false, "pending"]))).toEqual(new Set())
  })

  test("blocks from the first pending halt step when there are several", () => {
    expect(blockedStepIds(steps([true, "completed"], [false, "pending"], [true, "pending"], [true, "pending"], [false, "pending"])))
      .toEqual(new Set(["d", "e"]))
  })

  test("blocks a halt step that comes after another pending halt step", () => {
    expect(blockedStepIds(steps([true, "pending"], [true, "pending"]))).toEqual(new Set(["b"]))
  })

  test("blocks nothing for a run with no steps", () => {
    expect(blockedStepIds([])).toEqual(new Set())
  })
})
