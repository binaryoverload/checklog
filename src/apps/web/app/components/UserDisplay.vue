<script setup lang="ts">
import { useMemberQuery } from "~/queries/members.ts"

const props = defineProps<{
  userId: string
}>()

const { data: member, isLoading } = useMemberQuery(() => props.userId)

</script>

<template>
  <UUser v-if="member" :name="member.user.name" :avatar="{ src: member.user?.image ?? undefined, alt: member.user.name }" />
  <div v-else-if="!member && isLoading" class="flex items-center gap-2">
    <USkeleton class="size-8 rounded-full" />
    <USkeleton class="h-4 w-24 rounded-sm" />
  </div>
  <p v-else>Unknown User</p>
</template>
