<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui"

import type { CreateTemplateBody } from "@checklog/shared/api"
import { createTemplateBodySchema } from "@checklog/shared/api"
import { useCreateTemplateMutation } from "~/queries/templates"

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const form = useTemplateRef("form")
const { state, reset } = useFormState(() => ({
  name: "",
  description: undefined as string | undefined,
}))

const createTemplate = useCreateTemplateMutation()

const toast = useToast()
function onSubmit(event: FormSubmitEvent<CreateTemplateBody>) {
  createTemplate.mutate(event.data, {
    onSuccess: () => {
      toast.add({ title: "Created template " + event.data.name })
      close()
    },
  })
}

function close() {
  reset()
  form.value?.clear()
  emit("close")
}

</script>

<template>
  <UModal
    :open="open"
    title="New template"
    description="Start with a name; you'll add steps next."
    @update:open="close"
  >
    <template #body>
      <UForm
        id="create-template"
        ref="form"
        :schema="createTemplateBodySchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Name" name="name" required>
          <UInput
            v-model="state.name"
            placeholder="Opening checks"
            autofocus
            class="w-full"
          />
        </UFormField>
        <UFormField label="Description" name="description" hint="Optional">
          <UTextarea
            v-model="state.description"
            placeholder="What this checklist is for"
            :rows="3"
            autoresize
            class="w-full"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" label="Cancel" @click="close" />
        <UButton
          type="submit"
          form="create-template"
          label="Create template"
          :loading="createTemplate.isPending.value"
        />
      </div>
    </template>
  </UModal>
</template>
