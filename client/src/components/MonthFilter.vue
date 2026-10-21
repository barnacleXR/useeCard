<script setup lang="ts">
import { currencies } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
// 汇总、日历、月报共用的扣款月份与币种筛选。
const store = useWorkspace();
</script>
<template>
  <div class="toolbar">
    <label>扣款月份<input v-model="store.month" type="month" required></label>
    <label>币种<select v-model="store.currency"><option value="">全部币种（分别显示）</option><option v-for="(_, code) in currencies" :key="code">{{ code }}</option></select></label>
    <button class="quiet" :disabled="store.busy" @click="store.refresh">{{ store.busy ? '刷新中…' : '刷新' }}</button>
  </div>
</template>
