import type { Notification } from "@/util/types.ts"
import type { NotificationDto } from "@checklog/shared/api"

export function toNotificationDto(_row: Notification): NotificationDto {
  // TODO (person): list each field explicitly, never ...row
  throw new Error("toNotificationDto isn't written yet")
}
