<script setup lang="ts">
import { computed } from 'vue';
import { SSelect, useTheme } from '@vean/ui';
import { PALETTE_KEYS, resolveColorRef, type PaletteKey } from '@vean/theme';
import { presetName, presetValue, colors } from '../themePreset';
const theme = useTheme();
// 使用 Vean 自带的预设持久化，与外观面板、刷新和明暗按钮保持一致。
theme.customPresets.value = {...theme.customPresets.value, [presetName]:colors};
const items = [
  {value:presetValue,label:'Luxury Obsidian Gold'},
  ...PALETTE_KEYS.map(value => ({value,label:value})),
];
const selected = computed({
  get: () => theme.appliedPresetName.value === presetName ? presetValue : theme.primary.value,
  set: (value: string) => {
    if (value === presetValue) {
      // 清除旧的逐变量覆盖，让预设接管；首次选择直接展示黑金深色版本。
      theme.setThemeState({base:'zinc',primary:'amber',overrides:undefined,mode:'dark'});
      theme.applyPreset(presetName);
    } else {
      theme.resetPreset();
      theme.setThemeState({primary:value as PaletteKey,overrides:undefined});
    }
  },
});
const swatch = (value: string) => value === presetValue ? undefined : resolveColorRef(`${value}.500`);
</script>
<template>
  <SSelect v-model="selected" :items="items" class="theme-color-select" :trigger-props="{'aria-label':'主题色'}">
    <template #trigger-leading><span class="theme-color-swatch" :class="{'obsidian-gold':selected===presetValue}" :style="{background:swatch(selected)}" aria-hidden="true"/></template>
    <template #item-leading="{item}"><span class="theme-color-swatch" :class="{'obsidian-gold':item.value===presetValue}" :style="{background:swatch(String(item.value))}" aria-hidden="true"/></template>
  </SSelect>
</template>
