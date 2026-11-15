<script setup lang="ts">
const route = useRoute()

useHead(computed(() => ({
  title: route.meta.title ? `Checklog - ${route.meta.title}` : "Checklog",
})))
</script>

<template>
  <div class="flex min-h-svh items-center justify-center p-4">
    <div class="w-full max-w-sm">
      <slot />
    </div>
  </div>
</template>
