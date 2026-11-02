<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui"

defineProps<{ collapsed?: boolean }>()

const { data: session } = useSessionQuery()
const { data: organizations } = useOrganizationsQuery()
const setActive = useSetActiveOrganization()

const active = computed(() =>
  organizations.value?.find(org => org.id === session.value?.session.activeOrganizationId),
)

const items = computed<DropdownMenuItem[][]>(() => [
  (organizations.value ?? []).map(org => ({
    label: org.name,
    avatar: { alt: org.name },
    type: "checkbox" as const,
    checked: org.id === active.value?.id,
    onSelect: () => {
      if (org.id !== active.value?.id) setActive.mutate(org.id)
    },
  })),
  // TODO (person): "Create organization", once the create flow exists
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'start' }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      :label="collapsed ? undefined : (active?.name ?? 'Choose an organization')"
      :avatar="active ? { alt: active.name } : undefined"
      :icon="active ? undefined : 'i-lucide-building-2'"
      :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
      :loading="setActive.isPending.value"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :ui="{ trailingIcon: 'text-dimmed' }"
    />
  </UDropdownMenu>
</template>
