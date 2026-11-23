<script setup lang="ts">
import type { TemplateListItemDto } from "@checklog/shared/api"
import { templateAccessIncludes } from "@checklog/shared/domain"
import { useArchiveTemplateMutation, useRestoreTemplateMutation, useTemplateQuery, useTemplateVersionQuery } from "~/queries/templates.ts"

const props = defineProps<{ template: TemplateListItemDto }>()

const { data: details } = useTemplateQuery(() => props.template.id)
const template = computed(() => details.value ?? props.template)

const { data: templateVersion, isLoading: versionLoading } = useTemplateVersionQuery(
  () => template.value.id,
  () => template.value.currentVersion?.id,
)

const emit = defineEmits<{ close: [] }>()

const toast = useToast()
const confirm = useConfirm()
const archiveMutation = useArchiveTemplateMutation()
const restoreMutation = useRestoreTemplateMutation()

const archived = computed(() => template.value.status === "archived")

const canEdit = computed(() => templateAccessIncludes(template.value.accessLevel, "edit"))
const canRun = computed(() => templateAccessIncludes(template.value.accessLevel, "run") && !archived.value)

async function archiveTemplate() {
  const confirmed = await confirm({
    title: "Archive template?",
    description: `Are you sure you would like to archive the template '${template.value.name}'?`,
    confirmLabel: "Archive",
    color: "error",
  })
  if (confirmed) {
    archiveMutation.mutate(template.value.id, {
      onSuccess: () => toast.add({ title: "Template archived" }),
    })
  }
}

function restoreTemplate() {
  restoreMutation.mutate(template.value.id, {
    onSuccess: () => toast.add({ title: "Template restored" }),
  })
}
</script>

<template>
  <USlideover
    title="Template preview"
    :close="{ onClick: () => emit('close') }"
  >
    <template #body>
      <UPageHeader :title="template.name" :description="template.description ?? undefined" :ui="{ title: 'flex items-center gap-2' }">
        <template #title>
          <span>{{ template.name }}</span><UBadge v-if="archived" color="warning" label="Archived" />
        </template>
      </UPageHeader>
      <div class="flex gap-2 mb-4">
        <UButton
          label="View"
          color="neutral"
          :to="`/templates/${template.id}`"
          @click="emit('close')"
        />
        <UButton
          v-if="canRun"
          label="Start Run"
          color="primary"
          icon="i-lucide-circle-play"
        />
        <UButton
          v-if="canEdit && !archived"
          label="Archive"
          color="error"
          icon="i-lucide-archive"
          @click="archiveTemplate"
        />
        <UButton
          v-if="canEdit && archived"
          label="Restore"
          color="success"
          icon="i-lucide-archive-restore"
          @click="restoreTemplate"
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
              <div class="grid grid-cols-[20px_auto_1fr] gap-2">
                <div class="flex items-center justify-center">
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
