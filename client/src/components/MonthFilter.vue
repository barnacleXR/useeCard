<script setup lang="ts">
import { computed } from 'vue';
import { SIcon, SSelect } from '@vean/ui';
import { currencies } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import MonthInput from './fields/MonthInput.vue';

// 汇总、日历、月报共用的扣款月份与币种紧凑筛选组，可直接嵌入页头右侧。
const ALL = '__all__';
const store = useWorkspace();
const currencyModel = computed({
  get: () => store.currency || ALL,
  set: (value: string) => {
    store.currency = value === ALL ? '' : value;
  },
});
const currencyItems = computed(() => [
  { value: ALL, label: '全部币种' },
  ...Object.keys(currencies).map(value => ({ value, label: value })),
]);
</script>

<template>
  <div class="month-filter-bar">
    <MonthInput v-model="store.month" label="扣款月份" />
    <div class="month-filter-currency">
      <SSelect
        v-model="currencyModel"
        :items="currencyItems"
        :trigger-props="{ 'aria-label': '币种' }"
      />
    </div>
    <button
      type="button"
      class="quiet icon"
      :disabled="store.busy"
      :aria-label="store.busy ? '刷新中' : '刷新数据'"
      :title="store.busy ? '刷新中…' : '刷新数据'"
      @click="store.refresh"
    >
      <SIcon icon="lucide:refresh-cw" :class="{ spin: store.busy }" />
    </button>
  </div>
</template>

<style scoped>
.month-filter-bar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.month-filter-currency {
  width: 124px;
}

.month-filter-currency :deep([role='combobox']) {
  height: var(--control-h);
  min-height: var(--control-h);
  padding: 0 10px;
  background: var(--surface-card);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 13px;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
