<script setup lang="ts">
import { useTemplateQuery } from "~/queries/templates.ts"

definePageMeta({ title: "Template" })

const route = useRoute()

const id = route.params.id as string

const templateQuery = useTemplateQuery(() => id)
const template = computed(() => templateQuery.data?.value)

</script>

<template>
  <div v-if="template">
    <UBreadcrumb class="mb-8" :items="[{ label: 'Templates', to: '/templates' }, { label: template.name ?? 'Template' }]" />
    <UPageHeader
      :description="template.description ?? undefined"
      :ui="{ title: 'flex items-center gap-2' }"
    >
      <template #title>
        <span class="flex items-center">
          {{ template.name }}
          <span class="flex gap-2 ml-4">
            <UBadge
              v-if="template.status === 'archived'"
              label="Archived"
              color="neutral"
              variant="outline"
              size="lg"
            />
            <VersionTags :template="template" size="lg" />
            <TemplateAccessLevelBadge :access-level="template.accessLevel" size="lg" />
          </span>
        </span>
      </template>
    </UPageHeader>
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
