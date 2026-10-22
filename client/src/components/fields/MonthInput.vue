<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { SPopover } from '@vean/ui';
import { japanMonth } from '@ccm/shared';
import { formatMonth, parseMonth } from './date-values';
// 月份（YYYY-MM）：左右箭头逐月切换，点击中间弹出按年份的月份网格。clearable 时允许留空。
const model = defineModel<string>({default: ''});
const props = defineProps<{clearable?: boolean; label?: string; disabled?: boolean}>();
const open = ref(false);
const current = computed(() => parseMonth(model.value));
const fallback = () => parseMonth(japanMonth())!;
const viewYear = ref((current.value ?? fallback()).year);
watch(open, value => { if (value) viewYear.value = (current.value ?? fallback()).year; });
const text = computed(() => current.value ? `${current.value.year}年${current.value.month}月` : '未选择');
function shift(delta: number) {
  const base = current.value ?? fallback();
  const index = base.year * 12 + base.month - 1 + delta;
  model.value = formatMonth(Math.floor(index / 12), index % 12 + 1);
}
function pick(month: number) { model.value = formatMonth(viewYear.value, month); open.value = false; }
const thisMonth = computed(() => parseMonth(japanMonth())!);
</script>
<template>
  <div class="month-input" role="group" :aria-label="label">
    <button type="button" class="quiet icon" aria-label="上个月" :disabled="disabled" @click="shift(-1)">‹</button>
    <SPopover v-model:open="open">
      <template #trigger>
        <button type="button" class="month-input-trigger" :class="{placeholder: !current}" :disabled="disabled" :aria-label="`${label ?? '月份'}：${text}`">{{ text }}</button>
      </template>
      <div class="month-panel">
        <div class="row month-panel-head">
          <button type="button" class="quiet icon" aria-label="上一年" @click="viewYear--">‹</button>
          <strong>{{ viewYear }} 年</strong>
          <button type="button" class="quiet icon" aria-label="下一年" @click="viewYear++">›</button>
        </div>
        <div class="month-grid">
          <button v-for="m in 12" :key="m" type="button" class="month-cell"
                  :class="{selected: current?.year === viewYear && current?.month === m, today: thisMonth.year === viewYear && thisMonth.month === m}"
                  :aria-pressed="current?.year === viewYear && current?.month === m" @click="pick(m)">{{ m }}月</button>
        </div>
        <div v-if="props.clearable && current" class="month-panel-foot"><button type="button" class="quiet" @click="model = ''; open = false">清除</button></div>
      </div>
    </SPopover>
    <button type="button" class="quiet icon" aria-label="下个月" :disabled="disabled" @click="shift(1)">›</button>
  </div>
</template>
