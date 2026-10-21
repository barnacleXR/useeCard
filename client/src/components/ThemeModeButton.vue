<script setup lang="ts">
import { computed } from 'vue';
import { SIcon, useTheme } from '@vean/ui';
// 顶栏明暗切换：与相邻按钮同一描边样式；点击设为明确的浅色/深色，“跟随系统”在外观设置里选择。
const theme = useTheme('ThemeModeButton');
const dark = computed(() => theme.effectiveMode.value === 'dark');
const label = computed(() => dark.value ? '切换为浅色模式' : '切换为深色模式');
</script>
<template>
  <button class="quiet icon-button" type="button" :aria-label="label" :title="label" @click="theme.setMode(dark ? 'light' : 'dark')">
    <SIcon :icon="dark ? 'lucide:moon' : 'lucide:sun'"/>
  </button>
</template>
