<script setup lang="ts">
import type { ButtonProps, TableColumn } from "@nuxt/ui"
import { capitalize } from "es-toolkit"

import { TemplateSlideover } from "#components"
import type { TemplateListItemDto } from "@checklog/shared/api"
import type { TemplateStatus } from "@checklog/shared/domain"
import { templateStatuses } from "@checklog/shared/domain"
import { useTemplatesQuery } from "~/queries/templates.ts"

definePageMeta({ title: "Templates" })

const VersionTags = resolveComponent("VersionTags")
const UserDisplay = resolveComponent("UserDisplay")
const NuxtTime = resolveComponent("NuxtTime")

const columns: TableColumn<TemplateListItemDto>[] = [
  {
    header: "Name",
    cell: ({ row }) => {
      const { name, description } = row.original
      return h("div", { class: "space-y-1" }, [
        h("p", { class: "font-semibold text-highlighted" }, name),
        description ? h("p", {}, description) : null,
      ])
    },
  },
  {
    header: "Version",
    cell: ({ row }) => {
      return h(VersionTags, { template: row.original })
    },
  },
  {
    header: "Steps",
    cell: ({ row }) => row.original.currentVersion?.stepCount ?? "-",
  },
  {
    header: "Created",
    accessorKey: "createdAt",
    cell: ({ row }) => h(NuxtTime, { datetime: row.getValue("createdAt"), dateStyle: "short", timeStyle: "short" }),
  },
  {
    header: "Created By",
    cell: ({ row }) => h(UserDisplay, { userId: row.original.createdBy }),
  },
]

const pageDescription = computed(() => `${data.value?.total ?? "-"} ${data.value?.total === 1 ? "template" : "templates"}`)

const can = useCan()

const pageLinks = computed<ButtonProps[]>(() => [
  {
    label: "New Template",
    color: "primary",
    variant: "soft",
    icon: "i-lucide-plus",
    onClick: () => createModalOpen.value = true,
    disabled: !can({ template: ["create"] }),
  },
])

const overlay = useOverlay()
const slideover = overlay.create(TemplateSlideover)

const createModalOpen = ref(false)
const selectedTab = ref<TemplateStatus>("active")

watch(selectedTab, () => {
  page.value = 1
})

const tabItems = templateStatuses.map(s => ({ label: capitalize(s), value: s }))

const itemsPerPage = 10
const page = ref(1)

const { data, isLoading } = useTemplatesQuery(() => ({ status: selectedTab.value, limit: itemsPerPage, page: page.value }))

const templates = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total)
</script>

<template>
  <div>
    <CreateTemplateModal :open="createModalOpen" @close="createModalOpen = false" />
    <UPageHeader
      title="Templates"
      :description="pageDescription"
      :links="pageLinks"
    />
    <div class="w-max"><UTabs v-model="selectedTab" variant="pill" :items="tabItems" /></div>

    <UTable
      :ui="{ tr: 'data-[selectable=true]:cursor-pointer' }"
      :loading="isLoading"
      :data="templates"
      :columns="columns"
      @select="(_event, row) => slideover.open({ template: row.original })"
    />
    <div v-if="(total ?? 0) > itemsPerPage" class="flex justify-center py-4">
      <UPagination v-model:page="page" :total="total ?? 0" :items-per-page="itemsPerPage" />
    </div>
  </div>
</template>
