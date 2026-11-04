<script setup lang="ts">
const { data: organizations, isPending } = useOrganizationsQuery()
const setActive = useSetActiveOrganization()
</script>

<template>
  <div class="h-full flex items-center justify-center">
    <UCard class="w-full max-w-96 py-4">
      <div class="flex flex-col items-center mb-4">
        <UIcon name="i-lucide-building-2" class="size-8 mb-4" />
        <h1 class="mb-4">Choose an organization to continue</h1>
      </div>
      <div class="space-y-2">
        <UEmpty
          v-if="!isPending && (!organizations || organizations.length === 0)"
          title="No organizations found"
          description="You are not a member of any organization."
          variant="soft"
          :actions="[
            {
              label: 'Create organization',
              color: 'primary',
              onClick: () => {
                // TODO: Handle create organization action
              }
            }
          ]"
        />
        <UButton
          v-for="organization in organizations"
          v-else
          :key="organization.id"
          :label="organization.name"
          color="neutral"
          block
          :loading="setActive.isPending.value && setActive.variables.value === organization.id"
          :disabled="setActive.isPending.value && setActive.variables.value !== organization.id"
          @click="setActive.mutate(organization.id)"
        />
      </div>
      <UAlert
        v-if="setActive.error.value"
        title="Failed to set your active organization"
        description="An error occurred - please try again."
        color="error"
        variant="subtle"
        class="mt-4"
      />
    </UCard>
  </div>
</template>
