<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 40 });
</script>

<template>
  <img class="brand-logo" src="/favicon.svg" :width="size" :height="size" alt="useeCard" />
</template>
