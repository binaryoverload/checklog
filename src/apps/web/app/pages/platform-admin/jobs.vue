<script setup lang="ts">
definePageMeta({
  auth: "platform-admin",
  title: "Jobs Dashboard",
  organization: "none",
})
</script>

<template>
  <div style="height: 100vh">
    <iframe src="/api/admin/jobs" width="100%" height="100%"/>
  </div>
</template>
