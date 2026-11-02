<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui"
import * as z from "zod"

import { requiredString } from "@checklog/shared"

definePageMeta({
  layout: "auth",
  auth: "public",
})

useSeoMeta({
  title: "Sign up",
  description: "Create an account to get started",
})

const fields = [{
  name: "name",
  type: "text" as const,
  label: "Name",
  placeholder: "Enter your name",
}, {
  name: "email",
  type: "text" as const,
  label: "Email",
  placeholder: "Enter your email",
}, {
  name: "password",
  label: "Password",
  type: "password" as const,
  placeholder: "Enter your password",
}]

const schema = z.object({
  name: requiredString("Name is required"),
  email: z.email("Invalid email"),
  password: z.string("Password is required").min(8, "Must be at least 8 characters"),
})

type Schema = z.output<typeof schema>

function onSubmit(payload: FormSubmitEvent<Schema>) {
  console.log("Submitted", payload)
}
</script>

<template>
  <UAuthForm
    :fields="fields"
    :schema="schema"
    title="Create an account"
    :submit="{ label: 'Create account' }"
    @submit="onSubmit"
  >
    <template #description>
      Already have an account? <ULink
        to="/login"
        class="text-primary font-medium"
      >
        Login
      </ULink>.
    </template>

    <template #footer>
      By signing up, you agree to our <ULink
        to="/"
        class="text-primary font-medium"
      >
        Terms of Service
      </ULink>.
    </template>
  </UAuthForm>
</template>
