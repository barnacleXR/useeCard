<script setup lang="ts">
import { computed } from 'vue';
import { SIcon, useTheme } from '@vean/ui';

// 轻量明暗切换按钮：与侧栏/顶栏图标尺寸一致，支持浅色/深色一键切换。
const theme = useTheme('ThemeModeButton');
const dark = computed(() => theme.effectiveMode.value === 'dark');
const label = computed(() => (dark.value ? '切换为浅色模式' : '切换为深色模式'));
</script>

<template>
  <button
    class="quiet ghost icon"
    type="button"
    :aria-label="label"
    :title="label"
    @click="theme.setMode(dark ? 'light' : 'dark')"
  >
    <SIcon :icon="dark ? 'lucide:sun' : 'lucide:moon'" />
  </button>
</template>
