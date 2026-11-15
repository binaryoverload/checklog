import { ConfirmModal } from "#components"
import type { ConfirmOptions } from "~/components/ConfirmModal.vue"

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const overlay = useOverlay()
  return options => overlay.create(ConfirmModal, { destroyOnClose: true }).open(options)
}
