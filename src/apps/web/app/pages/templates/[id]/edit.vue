<script setup lang="ts">
import { useTemplateQuery } from "~/queries/templates.ts"

definePageMeta({ title: "Edit Template" })

const route = useRoute()

const id = route.params.id as string

const templateQuery = useTemplateQuery(() => id)
const template = computed(() => templateQuery.data?.value)

</script>

<template>
  <div v-if="template">
    <UBreadcrumb class="mb-8" :items="[{ label: 'Templates', to: '/templates' }, { label: template.name ?? 'Template', to: `/templates/${id}` }, { label: 'Edit' }]" />
    <UPageHeader
      :title="template.name"
      :description="template.description ?? undefined"
      :ui="{ title: 'flex items-center gap-2' }"
    />
    <UTabs
      variant="link"
      :content="false"
      :items="[
        { label: 'Steps', disabled: template.currentVersion == null },
        { label: 'Details' },
        { label: 'Schedule' },
        { label: 'Access' },
        { label: 'History' }
      ]"
      class="w-full"
    />
  </div>
</template>
