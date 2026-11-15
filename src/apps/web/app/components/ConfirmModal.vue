<script setup lang="ts">
import type { ButtonProps } from "@nuxt/ui"

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  color?: ButtonProps["color"]
}

defineProps<ConfirmOptions>()

defineEmits<{ close: [confirmed: boolean] }>()
</script>

<template>
  <UModal
    :title="title"
    :description="description"
    :ui="{ footer: 'justify-end' }"
    @update:open="$emit('close', false)"
  >
    <template #footer>
      <div class="flex gap-2">
        <UButton color="neutral" @click="$emit('close', false)">{{ cancelLabel || 'Cancel' }}</UButton>
        <UButton :color="color" :variant="color === 'error' ? 'solid' : 'soft'" @click="$emit('close', true)">{{ confirmLabel || 'Confirm' }}</UButton>
      </div>
    </template>
  </UModal>
</template>
