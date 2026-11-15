<script setup lang="ts">
import type { TemplateListItemDto } from "@checklog/shared/api"
import { templateAccessIncludes } from "@checklog/shared/domain"
import { useTemplateVersionQuery } from "~/queries/templates.ts"

const props = defineProps<{ template: TemplateListItemDto }>()

const { data: templateVersion, isLoading: versionLoading } = useTemplateVersionQuery(
  () => props.template.id,
  () => props.template.currentVersion?.id,
)
const emit = defineEmits<{ close: [boolean] }>()

</script>

<template>
  <USlideover
    title="Template preview"
    :close="{ onClick: () => emit('close', false) }"
  >
    <template #body>
      <UPageHeader :title="template.name" :description="template.description ?? undefined" />
      <div v-if="templateAccessIncludes(template.accessLevel, 'run')" class="flex gap-2 mb-4">
        <UButton v-if="templateAccessIncludes(template.accessLevel, 'edit')" label="Edit" color="neutral" />
        <UButton
          v-if="templateAccessIncludes(template.accessLevel, 'run')"
          label="Start Run"
          color="primary"
          icon="i-lucide-circle-play"
        />
        <UButton
          v-if="templateAccessIncludes(template.accessLevel, 'edit')"
          label="Archive"
          color="error"
          icon="i-lucide-archive"
        />
      </div>
      <USeparator class="mb-4" />
      <div class="grid grid-cols-3 mb-4">
        <div>
          <p class="text-muted text-sm mb-1">Created by</p>
          <UserDisplay :user-id="template.createdBy" />
        </div>
        <div>
          <p class="text-muted text-sm mb-1">Version</p>
          <VersionTags :template="template" />
        </div>
      </div>
      <USeparator class="mb-4" />
      <div v-if="versionLoading">
        Loading...
      </div>
      <div v-else-if="templateVersion">
        <div>
          <p class="mb-4">Steps</p>
          <div class="space-y-2">
            <template v-for="step in templateVersion.steps" :key="step.id">
              <div class="grid grid-cols-[10px_auto_1fr] gap-2">
                <div class="flex items-center">
                  <p class="text-muted text-sm">{{ step.position + 1 }}</p>
                </div>
                <div class="flex items-center">
                  <StepKindIcon :kind="step.kind" />
                </div>
                <div class="text-sm ml-2">
                  <p>{{ step.title }}</p>
                  <div class="flex gap-2 items-center text-muted">
                    <span>{{ step.fields.length }} {{ step.fields.length === 1 ? 'field' : 'fields' }}</span>
                    <UBadge
                      v-if="step.isHalt"
                      color="warning"
                      icon="i-lucide-octagon-pause"
                      label="Halt"
                    />
                    <UBadge
                      v-if="step.skippable"
                      color="neutral"
                      icon="i-lucide-skip-forward"
                      label="Skippable"
                    />
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>
  </USlideover>
</template>
