<script setup lang="ts">
import { useTheme } from '@vean/ui';
import { readThemeEnvelope } from '@vean/theme/storage';

// 首次访问跟随系统，后续由 Vean 恢复用户保存的模式。
const theme = useTheme();
if (!readThemeEnvelope()?.mode) theme.setMode('auto');
</script>
<template></template>
