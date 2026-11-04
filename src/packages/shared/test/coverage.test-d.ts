import { describe, expectTypeOf, test } from "vitest"

import type { FieldOptions, FieldType, FieldValue, NotificationPayload, NotificationType } from "@checklog/shared"

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
