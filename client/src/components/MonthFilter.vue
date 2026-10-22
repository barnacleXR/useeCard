<script setup lang="ts">
import { currencies } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import MonthInput from './fields/MonthInput.vue';
// 汇总、日历、月报共用的扣款月份与币种筛选。
const store = useWorkspace();
</script>
<template>
  <div class="toolbar">
    <div class="field"><span>扣款月份</span><MonthInput v-model="store.month" label="扣款月份"/></div>
    <label>币种<select v-model="store.currency"><option value="">全部币种（分别显示）</option><option v-for="(_, code) in currencies" :key="code">{{ code }}</option></select></label>
    <button class="quiet" :disabled="store.busy" @click="store.refresh">{{ store.busy ? '刷新中…' : '刷新' }}</button>
  </div>
</template>
