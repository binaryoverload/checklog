<script setup lang="ts">
import type { TemplateStepKind } from "@checklog/shared/domain"

defineProps<{ kind: TemplateStepKind }>()
</script>

<template>
  <div class="p-2 rounded-md flex items-center justify-center bg-muted">
    <UIcon v-if="kind === 'task'" name="i-lucide-square-check" class="text-muted" />
    <UIcon v-else-if="kind === 'approval'" name="i-lucide-stamp" class="text-warning" />
  </div>
</template>
