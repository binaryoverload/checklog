<script setup lang="ts">
definePageMeta({ title: "Home" })

const session = useSessionQuery()
</script>

<template>
  <div>
    <!-- TODO (person): the home page -->
    <pre>
{{ session.data }}
    </pre>
  </div>
</template>
