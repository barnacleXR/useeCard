<script setup lang="ts">
import { computed } from 'vue';
import { PhCaretRight, PhCheckSquare } from '@phosphor-icons/vue';
import { addMinor, formatMoney, japanToday, type Bill } from '@ccm/shared';
import { useWorkspace } from '../stores/workspace';
import { daysUntil, shortDate } from '../format';
import PageShell from '../components/PageShell.vue';
import MonthFilter from '../components/MonthFilter.vue';
import EntityIcon from '../components/EntityIcon.vue';
import CardBrandBadge from '../components/CardBrandBadge.vue';

const store = useWorkspace();
const today = japanToday();

const totals = computed(() => {
  const map = new Map<Bill['currency'], { currency: Bill['currency']; amountMinor: number; count: number }>();
  for (const account of store.summary.accounts) {
    for (const group of account.byCurrency) {
      const item = map.get(group.currency) ?? { currency: group.currency, amountMinor: 0, count: 0 };
      item.amountMinor = addMinor(item.amountMinor, group.pendingTotalMinor);
      item.count += group.byDate.reduce((n, d) => n + d.billCount, 0);
      map.set(group.currency, item);
    }
  }
  return [...map.values()];
});

// 已过期：之前月份的待确认账单，加上所选月份中扣款日已过仍待确认的账单。
const overdue = computed(() =>
  [...store.summary.historicalPending, ...store.bills.filter(b => b.status === 'pending' && b.dueDate < today)].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate),
  ),
);

const upcoming = computed(() =>
  store.bills
    .filter(b => b.status === 'pending' && b.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
);

const timeline = computed(() => [
  ...(overdue.value.length ? [{ title: '已过期待确认', bills: overdue.value, overdue: true }] : []),
  { title: '即将扣款', bills: upcoming.value, overdue: false },
]);

const unreviewed = computed(() => store.reviews.filter(r => r.status === 'unreviewed').length);
const reviewStatus = computed(() => {
  if (!store.reviews.length) return '未开始';
  return unreviewed.value ? `${unreviewed.value} 张待确认` : '已完成';
});

const dueLabel = (date: string) => {
  const d = daysUntil(date, today);
  return d === 0 ? '今天' : d === 1 ? '明天' : d < 0 ? `已过 ${-d} 天` : `${d} 天后`;
};

const billLink = (bill: Bill) => ({
  path: '/bills',
  query: {
    from: bill.dueDate,
    to: bill.dueDate,
    cardId: bill.cardId,
    status: 'pending',
  },
});
</script>

<template>
  <div class="summary-page">
    <PageShell subtitle="查看各扣款账户在所选月份需要准备的金额。">
      <div v-if="!store.accounts.length" class="panel empty summary-empty">
        <h2>添加第一个扣款账户</h2>
        <p>添加银行账户和信用卡，再参照银行 App 录入账单。</p>
        <RouterLink to="/manage" class="primary">添加账户与卡片</RouterLink>
      </div>

      <template v-else>
        <section class="funding-overview" aria-labelledby="funding-heading">
          <header class="summary-controls">
            <h2 id="funding-heading">当月待备款</h2>
            <MonthFilter />
          </header>
          <dl v-if="totals.length" class="funding-values">
            <div v-for="item in totals" :key="item.currency" class="funding-item">
              <dt>{{ item.currency }}</dt>
              <dd class="funding-amount">{{ formatMoney(item.amountMinor, item.currency).slice(item.currency.length + 1) }}</dd>
              <dd class="muted">{{ item.count }} 笔待扣款</dd>
            </div>
          </dl>
          <p v-else class="panel empty summary-empty">这个月还没有已录入的待还账单。请到月度检查确认是否有遗漏。</p>
        </section>

        <div class="summary-grid">
          <section>
            <header class="summary-section-head">
              <h2>按扣款账户备款</h2>
              <RouterLink to="/bills" class="link">全部账单 <span aria-hidden="true">›</span></RouterLink>
            </header>

            <p v-if="!store.summary.accounts.length" class="panel empty summary-empty">所选月份暂无待备款账户。</p>
            <div v-else class="account-grid">
              <article v-for="item in store.summary.accounts" :key="item.accountId" class="account-card">
                <header class="account-head">
                  <EntityIcon
                    :name="item.accountName"
                    :asset-id="store.accountById.get(item.accountId)?.iconAssetId"
                    :size="32"
                  />
                  <h3>{{ item.accountName }}</h3>
                </header>

                <div v-for="group in item.byCurrency" :key="group.currency" class="currency-block">
                  <p class="amount-large">{{ formatMoney(group.pendingTotalMinor, group.currency) }}</p>
                  <div v-for="day in group.byDate" :key="day.dueDate" class="date-line">
                    <span><time :datetime="day.dueDate">{{ shortDate(day.dueDate) }}</time> <small>· {{ day.billCount }} 笔</small></span>
                    <strong>{{ formatMoney(day.amountMinor, group.currency) }}</strong>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <aside class="summary-side" aria-label="扣款安排和月度检查">
            <section>
              <header class="summary-section-head">
                <h2>扣款安排</h2>
                <RouterLink to="/calendar" class="link">日历视图 <span aria-hidden="true">›</span></RouterLink>
              </header>
              <div class="timeline-card">
                <section v-for="group in timeline" :key="group.title" class="timeline-group">
                  <header class="timeline-card-head">
                    <h3 :class="{ urgent: group.overdue }">{{ group.title }} <span>{{ group.bills.length }}</span></h3>
                    <RouterLink v-if="group.overdue" :to="{ path: '/bills', query: { status: 'pending' } }" class="link">
                      去处理 <span aria-hidden="true">›</span>
                    </RouterLink>
                  </header>
                  <p v-if="!group.bills.length" class="timeline-empty">所选月份没有即将扣款的账单。</p>
                  <RouterLink v-for="bill in group.bills" :key="bill.id" :to="billLink(bill)" class="timeline-item">
                    <time :datetime="bill.dueDate" :title="shortDate(bill.dueDate)" class="timeline-date">
                      {{ bill.dueDate.slice(5).replace('-', '.') }}
                    </time>
                    <div class="timeline-info">
                      <strong>{{ bill.cardName }}</strong>
                      <div class="timeline-account">
                        <CardBrandBadge :brand="store.cardById.get(bill.cardId)?.brand ?? ''" />
                        <span>{{ bill.accountName }}</span>
                      </div>
                    </div>
                    <div class="timeline-right">
                      <strong>{{ formatMoney(bill.amountMinor, bill.currency) }}</strong>
                      <span :class="{ urgent: group.overdue || bill.dueDate === today }">{{ dueLabel(bill.dueDate) }}</span>
                    </div>
                  </RouterLink>
                </section>
              </div>
            </section>

            <RouterLink to="/reviews" class="summary-review">
              <PhCheckSquare :size="18" aria-hidden="true" />
              <div class="summary-review-info">
                <strong>月度检查</strong>
                <span class="muted">{{ store.reviewMonth }}</span>
              </div>
              <span class="status" :class="!store.reviews.length || unreviewed ? 'unreviewed' : 'reviewed'">{{ reviewStatus }}</span>
              <PhCaretRight :size="16" aria-hidden="true" />
            </RouterLink>
          </aside>
        </div>
      </template>
    </PageShell>
  </div>
</template>
