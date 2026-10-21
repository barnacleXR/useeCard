<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { CardBrand } from '@ccm/shared';
import { CARD_NETWORKS } from '../icons';
// 图标优先级：自定义图片 → 卡组织图标 → 彩色首字母兜底；图片加载失败时自动退回下一级。
const props = withDefaults(defineProps<{name: string; assetId?: string | null; brand?: CardBrand | ''; size?: number}>(), {assetId: null, brand: '', size: 40});
const failed = ref(false);
watch(() => props.assetId, () => { failed.value = false; });
const kind = computed(() => props.assetId && !failed.value ? 'asset' : props.brand ? 'brand' : 'mono');
// 按名称生成稳定色相，同名卡片颜色一致。
const hue = computed(() => [...props.name].reduce((h, c) => (h * 31 + c.codePointAt(0)!) % 360, 7));
const letter = computed(() => [...props.name.trim()][0]?.toUpperCase() ?? '?');
</script>
<template>
  <span class="entity-icon" :class="kind" :style="{'--icon-size': `${size}px`, '--icon-hue': hue}" :title="name">
    <img v-if="kind === 'asset'" :src="`/api/assets/${assetId}`" :alt="`${name} 图标`" loading="lazy" @error="failed = true">
    <img v-else-if="kind === 'brand'" :src="brand ? CARD_NETWORKS[brand].icon : undefined" :alt="`${brand ? CARD_NETWORKS[brand].label : ''} 卡组织`" loading="lazy">
    <span v-else aria-hidden="true">{{ letter }}</span>
  </span>
</template>
