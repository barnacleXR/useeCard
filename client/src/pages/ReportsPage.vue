<script setup lang="ts">
import { computed } from 'vue';
import { formatMoney } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import PageShell from '../components/PageShell.vue';
import MonthFilter from '../components/MonthFilter.vue';
import BillList from '../components/BillList.vue';

const store = useWorkspace();
const details = computed(() => store.bills.filter(b => b.status !== 'void'));
const paidRatio = (paid: number, total: number) => (total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0);
</script>

<template>
  <PageShell>
    <template #actions>
      <MonthFilter />
    </template>

    <div v-if="!store.report.byCurrency.length" class="panel empty" style="margin-bottom: 20px">
      这个月没有有效账单。
    </div>

    <section v-else class="account-grid" style="margin-bottom: 24px">
      <article v-for="group in store.report.byCurrency" :key="group.currency" class="account-card">
        <div class="row">
          <span class="eyebrow">{{ group.currency }} · {{ group.billCount }} 笔有效账单</span>
          <span class="status paid">已还 {{ paidRatio(group.paidMinor, group.totalMinor) }}%</span>
        </div>
        <h2 class="amount-large">{{ formatMoney(group.totalMinor, group.currency) }}</h2>
        <div class="report-bar" aria-hidden="true">
          <div class="report-bar-fill" :style="{ width: `${paidRatio(group.paidMinor, group.totalMinor)}%` }" />
        </div>
        <div>
          <div class="date-line">
            <span>待确认扣款</span>
            <strong>{{ formatMoney(group.pendingMinor, group.currency) }}</strong>
          </div>
          <div class="date-line">
            <span>已确认扣款</span>
            <strong>{{ formatMoney(group.paidMinor, group.currency) }}</strong>
          </div>
        </div>
      </article>
    </section>

    <section class="tile-section">
      <div class="section-head">
        <h2 class="section-title">当月有效明细 · {{ details.length }}</h2>
      </div>
      <BillList :bills="details" empty="这个月没有有效账单。" />
    </section>
  </PageShell>
</template>
