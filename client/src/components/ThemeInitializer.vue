<script setup lang="ts">
import { onMounted } from 'vue';
import { useTheme } from '@vean/ui';
import { colors, presetName } from '../themePreset';

// 统一应用现代极简金融风配色预设，同时保留用户选择的浅色/深色/跟随系统模式。
const theme = useTheme();
onMounted(() => {
  theme.customPresets.value = { [presetName]: colors };
  theme.applyPreset(presetName);
});
</script>
<template></template>
