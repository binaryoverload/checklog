<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui"

defineProps<{ collapsed?: boolean }>()

const { data: session } = useSessionQuery()
const signOut = useSignOut()
const colorMode = useColorMode()

const user = computed(() => session.value?.user)

const appearance = (["system", "light", "dark"] as const).map(mode => ({
  label: mode[0]!.toUpperCase() + mode.slice(1),
  icon: { system: "i-lucide-monitor", light: "i-lucide-sun", dark: "i-lucide-moon" }[mode],
  type: "checkbox" as const,
  get checked() {
    return colorMode.preference === mode
  },
  onSelect: (event: Event) => {
    event.preventDefault()
    colorMode.preference = mode
  },
}))

const items = computed<DropdownMenuItem[][]>(() => [
  [{ type: "label", label: user.value?.name, description: user.value?.email }],
  [{ label: "Appearance", icon: "i-lucide-sun-moon", children: appearance }],
  [{ label: "Sign out", icon: "i-lucide-log-out", onSelect: () => signOut.mutate() }],
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      :label="collapsed ? undefined : user?.name"
      :avatar="{ src: user?.image ?? undefined, alt: user?.name }"
      :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :ui="{ trailingIcon: 'text-dimmed' }"
    />
  </UDropdownMenu>
</template>
