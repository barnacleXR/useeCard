<script setup lang="ts">
import { computed } from 'vue';
import { SDatePicker } from '@vean/ui';
import { WEEK_STARTS_ON, formatDay, parseDay } from './date-values';
// 单个日期（YYYY-MM-DD）；min / max 同样是日期字符串。
const model = defineModel<string>({default: ''});
const props = defineProps<{min?: string; max?: string; disabled?: boolean; label?: string}>();
const value = computed({get: () => parseDay(model.value), set: v => { model.value = formatDay(v); }});
</script>
<template>
  <SDatePicker v-model="value" class="date-input" :week-starts-on="WEEK_STARTS_ON" :min-value="parseDay(props.min)" :max-value="parseDay(props.max)" :disabled="disabled" :aria-label="label"/>
</template>
