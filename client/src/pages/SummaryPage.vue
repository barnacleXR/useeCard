<script setup lang="ts">
import { computed } from 'vue';
import { addMinor, formatMoney, japanToday, type Bill } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import { daysUntil, shortDate } from '../format';
import PageShell from '../components/PageShell.vue';
import MonthFilter from '../components/MonthFilter.vue';
import EntityIcon from '../components/EntityIcon.vue';
import CardArtwork from '../components/CardArtwork.vue';
import CardBrandBadge from '../components/CardBrandBadge.vue';
// 页面结构：统计卡片 → 逾期/即将付款的横向小卡片 → 按账户的明细。
const store = useWorkspace(); const today = japanToday();
const totals = computed(() => {
  const map = new Map<string, {currency: Bill['currency']; amount: number; count: number}>();
  for (const account of store.summary.accounts) for (const group of account.byCurrency) {
    const item = map.get(group.currency) ?? {currency: group.currency, amount: 0, count: 0};
    item.amount = addMinor(item.amount, group.pendingTotalMinor); item.count += group.byDate.reduce((n, d) => n + d.billCount, 0); map.set(group.currency, item);
  }
  return [...map.values()];
});
// 已过期：之前月份的待确认账单，加上所选月份中扣款日已过仍待确认的账单。
const overdue = computed(() => [...store.summary.historicalPending, ...store.bills.filter(b => b.status === 'pending' && b.dueDate < today)].sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
const upcoming = computed(() => store.bills.filter(b => b.status === 'pending' && b.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
const unreviewed = computed(() => store.reviews.filter(r => r.status === 'unreviewed').length);
const dueLabel = (date: string) => { const d = daysUntil(date, today); return d === 0 ? '今天' : d === 1 ? '明天' : d < 0 ? `已过 ${-d} 天` : `${d} 天后`; };
</script>
<template>
  <PageShell>
    <MonthFilter/>
    <div v-if="!store.accounts.length" class="panel empty"><h2>从你的第一个扣款账户开始</h2><p>添加银行账户和信用卡，再录入银行 App 上的账单。</p><RouterLink to="/manage" class="link">添加账户与卡片 →</RouterLink></div>
    <template v-else>
      <section class="statistics">
        <article v-for="item in totals" :key="item.currency" class="stat-tile"><span class="stat-label">{{ store.month }} 待备款 · {{ item.currency }}</span><strong class="stat-value">{{ formatMoney(item.amount, item.currency) }}</strong><small>{{ item.count }} 笔已录入</small></article>
        <article v-if="!totals.length" class="stat-tile"><span class="stat-label">{{ store.month }} 待备款</span><strong class="stat-value">—</strong><small>还没有已录入的待还账单</small></article>
        <RouterLink to="/reviews" class="stat-tile link-tile"><span class="stat-label">{{ store.reviewMonth }} 月度检查</span><strong class="stat-value">{{ store.reviews.length ? unreviewed : '未开始' }}</strong><small>{{ store.reviews.length ? '张卡尚未确认' : '不自动推断为零账单' }}</small></RouterLink>
      </section>

      <section v-if="overdue.length" class="tile-section">
        <h2 class="list-title warn">已过期待确认</h2>
        <div class="tile-scroll"><div class="tile-row">
          <RouterLink v-for="bill in overdue" :key="bill.id" to="/bills" class="bill-tile overdue" :title="`${bill.cardName} · ${bill.accountName}`">
            <CardArtwork :name="bill.cardName" :asset-id="store.cardById.get(bill.cardId)?.iconAssetId" :last4="store.cardById.get(bill.cardId)?.last4" :width="64"/><CardBrandBadge class="tile-brand" :brand="store.cardById.get(bill.cardId)?.brand ?? ''"/>
            <div><small>{{ shortDate(bill.dueDate) }}</small><small class="tile-due">{{ dueLabel(bill.dueDate) }}</small><strong>{{ formatMoney(bill.amountMinor, bill.currency) }}</strong></div>
          </RouterLink>
        </div></div>
      </section>

      <section class="tile-section">
        <h2 class="list-title">即将扣款</h2>
        <div v-if="!upcoming.length" class="muted tile-empty">所选月份没有今天之后的待扣款账单。</div>
        <div v-else class="tile-scroll"><div class="tile-row">
          <RouterLink v-for="bill in upcoming" :key="bill.id" to="/bills" class="bill-tile" :title="`${bill.cardName} · ${bill.accountName}`">
            <CardArtwork :name="bill.cardName" :asset-id="store.cardById.get(bill.cardId)?.iconAssetId" :last4="store.cardById.get(bill.cardId)?.last4" :width="64"/><CardBrandBadge class="tile-brand" :brand="store.cardById.get(bill.cardId)?.brand ?? ''"/>
            <div><small>{{ shortDate(bill.dueDate) }}</small><small class="tile-due">{{ dueLabel(bill.dueDate) }}</small><strong>{{ formatMoney(bill.amountMinor, bill.currency) }}</strong></div>
          </RouterLink>
        </div></div>
      </section>

      <section class="tile-section">
        <h2 class="list-title">按扣款账户备款</h2>
        <div v-if="!store.summary.accounts.length" class="panel empty"><p>这个月还没有已录入的待还账单。这不代表已经检查全部卡片。</p></div>
        <div class="account-grid">
          <article v-for="item in store.summary.accounts" :key="item.accountId" class="panel account-panel">
            <header class="account-head"><EntityIcon :name="item.accountName" :asset-id="store.accountById.get(item.accountId)?.iconAssetId" :size="36"/><h2>{{ item.accountName }}</h2></header>
            <div v-for="group in item.byCurrency" :key="group.currency" class="currency-block">
              <p class="amount-large">{{ formatMoney(group.pendingTotalMinor, group.currency) }}</p>
              <div v-for="day in group.byDate" :key="day.dueDate" class="date-line"><span>{{ shortDate(day.dueDate) }} <small>· {{ day.billCount }} 笔</small></span><strong>{{ formatMoney(day.amountMinor, group.currency) }}</strong></div>
            </div>
          </article>
        </div>
      </section>
    </template>
  </PageShell>
</template>
