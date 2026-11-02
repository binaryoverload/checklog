<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui"

const route = useRoute()

const main: NavigationMenuItem[] = [
  { label: "Home", icon: "i-lucide-house", to: "/" },
  { label: "Runs", icon: "i-lucide-list-checks", to: "/runs" },
  { label: "Templates", icon: "i-lucide-file-stack", to: "/templates" },
  { label: "Approvals", icon: "i-lucide-badge-check", to: "/approvals" },
  { label: "Notifications", icon: "i-lucide-bell", to: "/notifications" },
]

const organization: NavigationMenuItem[] = [
  { label: "Members", icon: "i-lucide-users", to: "/members" },
  { label: "Groups", icon: "i-lucide-users-round", to: "/groups" },
]
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      collapsible
      resizable
      :ui="{ footer: 'border-t border-default' }"
    >
      <template #header="{ collapsed }">
        <AppOrganizationSwitcher :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="main"
          orientation="vertical"
          tooltip
        />
        <UNavigationMenu
          :collapsed="collapsed"
          :items="organization"
          orientation="vertical"
          tooltip
          class="mt-auto"
        />
      </template>

      <template #footer="{ collapsed }">
        <AppUserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardPanel>
      <template #header>
        <UDashboardNavbar :title="route.meta.title ?? 'Checklog'">
          <template #leading>
            <UDashboardSidebarCollapse />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
