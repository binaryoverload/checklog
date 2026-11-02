<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui"
import { useQueryClient } from "@tanstack/vue-query"
import * as z from "zod"

import { requiredString } from "@checklog/shared"

definePageMeta({
  layout: "auth",
  auth: "public",
})

useSeoMeta({
  title: "Login",
  description: "Login to your account to continue",
})

const fields = [{
  name: "email",
  type: "text" as const,
  label: "Email",
  placeholder: "Enter your email",
  required: true,
}, {
  name: "password",
  label: "Password",
  type: "password" as const,
  placeholder: "Enter your password",
  required: true,
}, {
  name: "remember",
  label: "Remember me",
  type: "checkbox" as const,
  defaultValue: false,
}]

const schema = z.object({
  email: z.email("Invalid email"),
  password: requiredString("Password is required"),
  remember: z.boolean().default(false),
})

type Schema = z.output<typeof schema>

const auth = useAuth()
const queryClient = useQueryClient()
const route = useRoute()

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  const { error } = await auth.signIn.email({
    email: payload.data.email,
    password: payload.data.password,
    rememberMe: payload.data.remember,
  })
  if (error) {
    console.error(error)
    return
  }
  await queryClient.refetchQueries({ queryKey: ["session"] })
  const redirect = typeof route.query.redirect === "string" && route.query.redirect.startsWith("/") ? route.query.redirect : "/"
  await navigateTo(redirect)
}
</script>

<template>
  <UAuthForm
    :fields="fields"
    :schema="schema"
    title="Welcome back"
    icon="i-lucide-lock"
    @submit="onSubmit"
  >
    <template #description>
      Don't have an account? <ULink
        to="/signup"
        class="text-primary font-medium"
      >
        Sign up
      </ULink>.
    </template>

    <template #password-hint>
      <ULink
        to="/"
        class="text-primary font-medium"
        tabindex="-1"
      >
        Forgot password?
      </ULink>
    </template>

    <template #footer>
      By signing in, you agree to our <ULink
        to="/"
        class="text-primary font-medium"
      >
        Terms of Service
      </ULink>.
    </template>
  </UAuthForm>
</template>
