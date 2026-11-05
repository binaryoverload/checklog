<script setup lang="ts">
import type { StepperItem } from "@nuxt/ui"

import type { OrganizationType } from "@checklog/shared"

definePageMeta({ title: "Create Organization", organization: "none" })

const items = [
  {
    slot: "type" as const,
    title: "Organization Type",
    icon: "i-lucide-user-group",
  }, {
    slot: "details" as const,
    title: "Organization Details",
    icon: "i-lucide-form",
  }, {
    slot: "create" as const,
    title: "Create Organization",
    icon: "i-lucide-check-circle",
  },
] satisfies StepperItem[]

const stepper = useTemplateRef("stepper")
const selectedType = ref<OrganizationType>("personal")
</script>

<template>
  <div class="flex justify-center items-center h-full">
    <UStepper
      ref="stepper"
      :items="items"
      class="w-full max-w-3xl"
      :ui="{content:'p-4 flex flex-col justify-center items-center'}"
      :disabled="true"
    >
      <template #type>
        <p class="text-lg font-medium mb-8">What type of organization are you creating?</p>
        <div class="grid grid-cols-2 gap-4">
          <button class="block p-8 box-border cursor-pointer" :class="{ 'bg-sky-500/15 border border-sky-500/75 text-white': selectedType === 'personal' }" @click="selectedType = 'personal'">
            <UIcon name="i-lucide-user" class="w-6 h-6" />
            <p>Personal</p>
            <p class="text-sm text-muted">
              For personal use
            </p>
          </button>
          <button class="block p-8 box-border cursor-pointer" :class="{ 'bg-sky-500/15 border border-sky-500/75 text-white': selectedType === 'managed' }" @click="selectedType = 'managed'">
            <UIcon name="i-lucide-users" class="w-6 h-6" />
            <p>Managed</p>
            <p class="text-sm text-muted">
              For managed use
            </p>
          </button>
        </div>
        <UButton class="mt-8" size="xl" @click="stepper?.next()">
          Next
        </UButton>
      </template>

      <template #details>
        <p class="text-lg font-medium mb-8">Enter the details of your organization</p>

        <UFormField label="Organization Name" required>
          <UInput class="mb-4" label="Organization Name" placeholder="Enter organization name" />
        </UFormField>

        <div class="mt-8 space-x-4">
          <UButton class="mt-8" size="xl" @click="stepper?.prev()">
            Back
          </UButton>
          <UButton class="mt-8" size="xl" @click="stepper?.next()">
            Next
          </UButton>
        </div>
      </template>

      <template #create>
        <div class="mt-8">
          <UButton class="mt-8" size="xl" @click="stepper?.prev()">
            Back
          </UButton>
        </div>
      </template>
    </UStepper>
  </div>
</template>
