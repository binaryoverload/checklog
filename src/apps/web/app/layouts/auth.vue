<!-- For signed-out pages such as login: `definePageMeta({ layout: "auth", auth: "public" })` -->
<template>
  <div class="flex min-h-svh items-center justify-center p-4">
    <div class="w-full max-w-sm">
      <slot />
    </div>
  </div>
</template>
