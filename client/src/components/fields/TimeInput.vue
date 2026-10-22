<script setup lang="ts">
import { computed } from 'vue';
import { STimeField } from '@vean/ui';
import { formatTime, parseTime } from './date-values';
// 时间（HH:MM，24 小时制）。
const model = defineModel<string>({default: ''});
defineProps<{disabled?: boolean; label?: string}>();
const value = computed({get: () => parseTime(model.value), set: v => { model.value = formatTime(v); }});
</script>
<template>
  <STimeField v-model="value" class="time-input" granularity="minute" :hour-cycle="24" :disabled="disabled" :aria-label="label"/>
</template>
