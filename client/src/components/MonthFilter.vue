<script setup lang="ts">
import { currencies } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import MonthInput from './fields/MonthInput.vue';
import { SSelect } from '@vean/ui';
import { computed } from 'vue';
// 汇总、日历、月报共用的扣款月份与币种筛选。
const store = useWorkspace();
const currencyItems = computed(() => [{value: '', label: '全部币种（分别显示）'}, ...Object.keys(currencies).map(value => ({value, label: value}))]);
</script>
<template>
  <div class="toolbar">
    <div class="field"><span>扣款月份</span><MonthInput v-model="store.month" label="扣款月份"/></div>
    <div class="field filter-select"><span>币种</span><SSelect v-model="store.currency" :items="currencyItems" :trigger-props="{'aria-label': '币种'}"/></div>
    <button class="quiet" :disabled="store.busy" @click="store.refresh">{{ store.busy ? '刷新中…' : '刷新' }}</button>
  </div>
</template>
