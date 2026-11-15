<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui"

import type { CreateTemplateBody } from "@checklog/shared/api"
import { createTemplateBodySchema } from "@checklog/shared/api"
import { useCreateTemplateMutation } from "~/queries/templates"

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const state = reactive({
  name: "",
  description: undefined,
})

const createTemplate = useCreateTemplateMutation()

const toast = useToast()
function onSubmit(event: FormSubmitEvent<CreateTemplateBody>) {
  createTemplate.mutate(event.data, {
    onSuccess: () => {
      emit("close")
      toast.add({ title: "Created template " + event.data.name })
    },
  })
}

</script>

<template>
  <UModal :open="open" title="Create Template" @update:open="() => emit('close')">
    <template #body>
      <UForm
        :schema="createTemplateBodySchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Name" name="name">
          <UInput v-model="state.name"/>
        </UFormField>
        <UFormField label="Description" name="description">
          <UInput v-model="state.description"/>
        </UFormField>

        <UButton type="submit">Submit</UButton>
      </UForm>
    </template>
  </UModal>
</template>
