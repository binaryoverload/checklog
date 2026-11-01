import { describe, expectTypeOf, test } from "vitest"

import type { FieldType, NotificationType } from "./enums"
import type { FieldOptions, FieldValue } from "./fields"
import type { NotificationPayload } from "./notifications"

// Each discriminated union must have exactly one variant per value of its enum:
// a missing variant or a variant for a value that isn't in the enum both fail.
describe("every enum value has a matching variant", () => {
  test("field options cover every field type", () => {
    expectTypeOf<FieldOptions["type"]>().toEqualTypeOf<FieldType>()
  })

  test("field values cover every field type", () => {
    expectTypeOf<FieldValue["type"]>().toEqualTypeOf<FieldType>()
  })

  test("notification payloads cover every notification type", () => {
    expectTypeOf<NotificationPayload["type"]>().toEqualTypeOf<NotificationType>()
  })
})
