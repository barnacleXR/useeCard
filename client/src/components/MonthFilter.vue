<script setup lang="ts">
import { computed } from 'vue';
import { SSelect } from '@vean/ui';
import { PhArrowsClockwise, PhCaretUpDown } from '@phosphor-icons/vue';
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
      >
        <template #trigger-icon>
          <PhCaretUpDown :size="14" aria-hidden="true" />
        </template>
      </SSelect>
    </div>
    <button
      type="button"
      class="quiet icon"
      :disabled="store.busy"
      :aria-label="store.busy ? '刷新中' : '刷新数据'"
      :title="store.busy ? '刷新中…' : '刷新数据'"
      @click="store.refresh"
    >
      <PhArrowsClockwise :size="16" :class="{ spin: store.busy }" aria-hidden="true" />
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

@media (max-width: 520px) {
  .month-filter-bar {
    width: 100%;
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) var(--control-h-sm);
    gap: 6px;
  }

  .month-filter-currency {
    min-width: 0;
    width: auto;
  }

  .month-filter-currency :deep([role='combobox']) {
    padding-inline: 7px;
  }

  .month-filter-bar :deep(.month-input .quiet.icon),
  .month-filter-bar > .quiet.icon {
    width: var(--control-h-sm);
    min-width: var(--control-h-sm);
    height: var(--control-h-sm);
  }

  .month-filter-bar :deep(.month-input-trigger),
  .month-filter-currency :deep([role='combobox']) {
    height: var(--control-h-sm);
    min-height: var(--control-h-sm);
  }

  .month-filter-bar :deep(.month-input-trigger) {
    min-width: 92px;
    padding-inline: 8px;
  }
}

@media (max-width: 360px) {
  .month-filter-bar {
    gap: 4px;
  }

  .month-filter-bar :deep(.month-input) {
    gap: 2px;
  }

  .month-filter-currency :deep([role='combobox']) {
    column-gap: 2px;
    padding-inline: 6px;
    font-size: 12px;
  }

  .month-filter-bar :deep(.month-input .quiet.icon) {
    width: 26px;
    min-width: 26px;
  }

  .month-filter-bar :deep(.month-input-trigger) {
    min-width: 84px;
    padding-inline: 5px;
  }
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
