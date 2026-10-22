<script setup lang="ts">
import { onMounted } from 'vue';
import { useTheme } from '@vean/ui';
import { colors, presetName } from '../themePreset';
const props = defineProps<{firstRun: boolean}>();
const theme = useTheme();
onMounted(() => {
  if (!props.firstRun) return;
  theme.customPresets.value = {...theme.customPresets.value, [presetName]: colors};
  theme.applyPreset(presetName);
});
</script>
<template></template>
