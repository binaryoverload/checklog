<script setup lang="ts">
import type { TemplateAccessLevel } from "@checklog/shared/domain"

defineProps<{
  accessLevel: TemplateAccessLevel
}>()

const levels = {
  edit: { label: "Can edit", color: "success" },
  run: { label: "Can run", color: "info" },
  view: { label: "View only", color: "neutral" },
} as const
</script>

<template>
  <UBadge v-bind="levels[accessLevel]" variant="subtle" />
</template>
