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

// 备款优先仪表盘：核心指标条 → 左主区（按扣款账户备款） + 右侧栏（已过期待确认 & 即将扣款时间线）。
const store = useWorkspace();
const today = japanToday();

const totals = computed(() => {
  const map = new Map<string, { currency: Bill['currency']; amount: number; count: number }>();
  for (const account of store.summary.accounts) {
    for (const group of account.byCurrency) {
      const item = map.get(group.currency) ?? { currency: group.currency, amount: 0, count: 0 };
      item.amount = addMinor(item.amount, group.pendingTotalMinor);
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

const unreviewed = computed(() => store.reviews.filter(r => r.status === 'unreviewed').length);

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
  <PageShell>
    <template #actions>
      <MonthFilter />
    </template>

    <div v-if="!store.accounts.length" class="panel empty">
      <h2>从你的第一个扣款账户开始</h2>
      <p>添加银行账户和信用卡，再参照银行 App 录入账单。</p>
      <RouterLink to="/manage" class="primary">添加账户与卡片</RouterLink>
    </div>

    <template v-else>
      <!-- 双栏仪表盘：左主区（核心指标 + 按扣款账户备款）+ 右侧栏（逾期风险 + 即将扣款时间线，与左主区顶部齐平） -->
      <div class="summary-grid">
        <div class="summary-main">
          <!-- 核心指标条：按币种独立展示待备款 + 月度检查进度 -->
          <section class="kpi-strip" aria-label="当月概览">
            <article v-for="item in totals" :key="item.currency" class="kpi-card">
              <span class="kpi-label">{{ store.month }} 待备款 · {{ item.currency }}</span>
              <strong class="kpi-value">{{ formatMoney(item.amount, item.currency) }}</strong>
              <span class="kpi-meta">{{ item.count }} 笔已录入待扣款</span>
            </article>

            <article v-if="!totals.length" class="kpi-card">
              <span class="kpi-label">{{ store.month }} 待备款</span>
              <strong class="kpi-value">—</strong>
              <span class="kpi-meta">还没有已录入的待还账单</span>
            </article>

            <RouterLink
              to="/reviews"
              class="kpi-card interactive"
              :class="{ attention: !store.reviews.length || unreviewed > 0 }"
            >
              <span class="kpi-label">{{ store.reviewMonth }} 月度检查</span>
              <strong class="kpi-value">
                {{ !store.reviews.length ? '未开始' : unreviewed === 0 ? '全部已核对' : `${unreviewed} 张待确认` }}
              </strong>
              <span class="kpi-meta">
                {{
                  !store.reviews.length
                    ? '不自动推断为零账单 · 点击开始 →'
                    : unreviewed === 0
                      ? `共 ${store.reviews.length} 张卡已完成核对`
                      : `共 ${store.reviews.length} 张卡 · 前往核对 →`
                }}
              </span>
            </RouterLink>
          </section>

          <section>
            <div class="section-head">
              <h2 class="section-title">按扣款账户备款</h2>
              <RouterLink to="/bills" class="link" style="font-size: 12.5px">查看全部账单 →</RouterLink>
            </div>

            <div v-if="!store.summary.accounts.length" class="panel empty">
              <p>这个月还没有已录入的待还账单。这不代表已经检查全部卡片。</p>
            </div>

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
                  <small class="eyebrow">{{ group.currency }} 待备款</small>
                  <p class="amount-large">{{ formatMoney(group.pendingTotalMinor, group.currency) }}</p>
                  <div v-for="day in group.byDate" :key="day.dueDate" class="date-line">
                    <span>
                      {{ shortDate(day.dueDate) }} <small>· {{ day.billCount }} 笔</small>
                    </span>
                    <strong>{{ formatMoney(day.amountMinor, group.currency) }}</strong>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>

        <!-- 侧栏：逾期风险与即将扣款时间线 -->
        <aside class="summary-side" aria-label="扣款时间线">
          <section v-if="overdue.length" class="timeline-card overdue">
            <div class="timeline-card-head">
              <h2 class="section-title warn">已过期待确认 · {{ overdue.length }}</h2>
              <RouterLink :to="{ path: '/bills', query: { status: 'pending' } }" class="link" style="font-size: 12px">
                去处理 →
              </RouterLink>
            </div>
            <RouterLink v-for="bill in overdue" :key="bill.id" :to="billLink(bill)" class="timeline-item">
              <CardArtwork
                :name="bill.cardName"
                :asset-id="store.cardById.get(bill.cardId)?.iconAssetId"
                :last4="store.cardById.get(bill.cardId)?.last4"
                :width="44"
              />
              <div class="timeline-info">
                <strong>{{ bill.cardName }}</strong>
                <span class="timeline-meta">
                  <CardBrandBadge
                    v-if="store.cardById.get(bill.cardId)?.brand"
                    :brand="store.cardById.get(bill.cardId)?.brand ?? ''"
                    style="width: 22px"
                  />
                  <span>{{ bill.accountName }}</span>
                </span>
              </div>
              <div class="timeline-right">
                <strong>{{ formatMoney(bill.amountMinor, bill.currency) }}</strong>
                <span class="timeline-due urgent">{{ shortDate(bill.dueDate) }} · {{ dueLabel(bill.dueDate) }}</span>
              </div>
            </RouterLink>
          </section>

          <section class="timeline-card">
            <div class="timeline-card-head">
              <h2 class="section-title">即将扣款 · {{ upcoming.length }}</h2>
              <RouterLink to="/calendar" class="link" style="font-size: 12px">日历视图 →</RouterLink>
            </div>
            <div v-if="!upcoming.length" class="empty" style="padding: 28px 16px">
              所选月份没有今天之后的待扣款账单。
            </div>
            <RouterLink v-for="bill in upcoming" :key="bill.id" :to="billLink(bill)" class="timeline-item">
              <CardArtwork
                :name="bill.cardName"
                :asset-id="store.cardById.get(bill.cardId)?.iconAssetId"
                :last4="store.cardById.get(bill.cardId)?.last4"
                :width="44"
              />
              <div class="timeline-info">
                <strong>{{ bill.cardName }}</strong>
                <span class="timeline-meta">
                  <CardBrandBadge
                    v-if="store.cardById.get(bill.cardId)?.brand"
                    :brand="store.cardById.get(bill.cardId)?.brand ?? ''"
                    style="width: 22px"
                  />
                  <span>{{ bill.accountName }}</span>
                </span>
              </div>
              <div class="timeline-right">
                <strong>{{ formatMoney(bill.amountMinor, bill.currency) }}</strong>
                <span class="timeline-due" :class="{ urgent: daysUntil(bill.dueDate, today) <= 1 }">
                  {{ shortDate(bill.dueDate) }} · {{ dueLabel(bill.dueDate) }}
                </span>
              </div>
            </RouterLink>
          </section>
        </aside>
      </div>
    </template>
  </PageShell>
</template>
