<script setup lang="ts">
import type { ButtonProps, TableColumn } from "@nuxt/ui"

import { TemplateSlideover } from "#components"
import type { TemplateListItemDto } from "@checklog/shared/api"
import { useTemplatesQuery } from "~/queries/templates.ts"

definePageMeta({ title: "Templates" })

const { data, isLoading } = useTemplatesQuery({ status: "active", limit: 100 })

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

const pageDescription = computed(() => `${data.value?.pages[0]?.total ?? "-"} templates`)
const pageLinks: ButtonProps[] = [
  {
    label: "New Template",
    color: "primary",
    variant: "soft",
    icon: "i-lucide-plus",
    to: "/templates/new",
  },
]

const overlay = useOverlay()

const slideover = overlay.create(TemplateSlideover)

</script>

<template>
  <div>
    <UPageHeader
      title="Templates"
      :description="pageDescription"
      :links="pageLinks"
    />
    <UTable
      :ui="{ tr: 'data-[selectable=true]:cursor-pointer' }"
      :loading="isLoading"
      :data="data?.pages.flatMap(p => p.items)"
      :columns="columns"
      @select="(_event, row) => slideover.open({ template: row.original })"
    />
  </div>
</template>
