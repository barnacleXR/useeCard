<script setup lang="ts">
import { computed } from 'vue';
import { formatMoney } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import PageShell from '../components/PageShell.vue';
import MonthFilter from '../components/MonthFilter.vue';
import BillList from '../components/BillList.vue';
const store = useWorkspace();
const details = computed(() => store.bills.filter(b => b.status !== 'void'));
</script>
<template>
  <PageShell>
    <MonthFilter/>
    <div v-if="!store.report.byCurrency.length" class="panel empty">这个月没有有效账单。</div>
    <section class="account-grid">
      <article v-for="group in store.report.byCurrency" :key="group.currency" class="panel">
        <p class="eyebrow">{{ group.currency }} · {{ group.billCount }} 笔有效账单</p>
        <h2 class="amount-large">{{ formatMoney(group.totalMinor, group.currency) }}</h2>
        <div class="date-line"><span>待确认扣款</span><strong>{{ formatMoney(group.pendingMinor, group.currency) }}</strong></div>
        <div class="date-line"><span>已确认扣款</span><strong>{{ formatMoney(group.paidMinor, group.currency) }}</strong></div>
      </article>
    </section>
    <section class="tile-section"><h2 class="list-title">当月明细</h2><BillList :bills="details" empty="这个月没有有效账单。"/></section>
  </PageShell>
</template>
