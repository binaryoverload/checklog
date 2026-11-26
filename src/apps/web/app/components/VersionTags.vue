<script setup lang="ts">
defineProps<{
  template: {
    currentVersion: { version: number } | null
    draftVersion: { version: number } | null
  }
  size?: "sm" | "md" | "lg"
}>()
</script>

<template>
  <div class="flex gap-1">
    <UBadge
      v-if="template.currentVersion"
      color="success"
      variant="subtle"
      :size="size ?? 'md'"
      :label="`v${template.currentVersion.version}`"
    />
    <UBadge
      v-if="template.draftVersion"
      color="warning"
      variant="outline"
      :size="size ?? 'md'"
      :label="`v${template.draftVersion.version} draft`"
    />
  </div>
</template>
