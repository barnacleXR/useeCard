<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from '@vean/ui';
import { PhMoon, PhSun } from '@phosphor-icons/vue';

defineProps<{ showLabel?: boolean }>();
const theme = useTheme('ThemeModeButton');
const dark = computed(() => theme.effectiveMode.value === 'dark');
const label = computed(() => (dark.value ? '切换为浅色模式' : '切换为深色模式'));
</script>

<template>
  <button
    :class="showLabel ? undefined : 'quiet ghost icon'"
    type="button"
    :aria-label="label"
    :title="label"
    @click="theme.setMode(dark ? 'light' : 'dark')"
  >
    <component :is="dark ? PhSun : PhMoon" :size="18" :class="{ 'sidebar-link-icon': showLabel }" aria-hidden="true" />
    <span v-if="showLabel">{{ label }}</span>
  </button>
</template>
