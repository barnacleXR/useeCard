<script setup lang="ts">
import { useId } from 'vue';
// 站点标识：沿用 usee.sh 主站圆环，配色为黑卡式奢华黑金；与 public/favicon.svg 保持一致。
withDefaults(defineProps<{size?: number}>(), {size: 40});
// 同页多处使用时渐变 id 不能重复。
const id = useId();
</script>
<template>
  <svg class="brand-logo" :width="size" :height="size" viewBox="0 0 100 100" role="img" aria-label="useeCard">
    <defs>
      <linearGradient :id="`${id}-obsidian`" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d1e22"/><stop offset="1" stop-color="#0b0c0e"/></linearGradient>
      <linearGradient :id="`${id}-gold`" x1="0.15" y1="0.1" x2="0.85" y2="0.9"><stop offset="0" stop-color="#f6e3a8"/><stop offset="0.45" stop-color="#d6b26c"/><stop offset="1" stop-color="#94702f"/></linearGradient>
    </defs>
    <rect width="100" height="100" rx="22" :fill="`url(#${id}-obsidian)`"/>
    <rect x="1" y="1" width="98" height="98" rx="21" fill="none" stroke="#d6b26c" stroke-opacity="0.35" stroke-width="1.5"/>
    <circle cx="50" cy="50" r="30" fill="none" :stroke="`url(#${id}-gold)`" stroke-width="7.5"/>
  </svg>
</template>
