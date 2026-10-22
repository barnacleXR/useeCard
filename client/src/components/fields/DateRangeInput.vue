<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { SDateRangePicker } from '@vean/ui';
import type { DateRange } from '@vean/aria/date';
import { WEEK_STARTS_ON, formatDay, parseDay } from './date-values';
// 起止日期（闭区间，YYYY-MM-DD）。在日历中选择时开始日不会晚于结束日；任一端可留空。
const from = defineModel<string>('from', {default: ''});
const to = defineModel<string>('to', {default: ''});
defineProps<{label?: string}>();
// 组件不会因外部清空而重置输入框显示；从有值变为全空（清除、重置筛选）时重新挂载。
const resetKey = ref(0);
watch(() => !from.value && !to.value, (empty, wasEmpty) => { if (empty && !wasEmpty) resetKey.value++; });
const range = computed<DateRange>({
  get: () => ({start: parseDay(from.value) ?? null, end: parseDay(to.value) ?? null}),
  set: value => {
    let start = formatDay(value?.start), end = formatDay(value?.end);
    // 手动输入时也保证先后顺序。
    if (start && end && start > end) [start, end] = [end, start];
    from.value = start; to.value = end;
  },
});
</script>
<template>
  <div class="date-range-input">
    <SDateRangePicker :key="resetKey" v-model="range" :week-starts-on="WEEK_STARTS_ON" :aria-label="label"/>
    <!-- 始终占位，避免选中开始日后输入框变窄、日历弹层位移。 -->
    <button type="button" class="quiet icon" :class="{'is-hidden': !from && !to}" :disabled="!from && !to" aria-label="清除日期" @click="from = ''; to = ''">×</button>
  </div>
</template>
