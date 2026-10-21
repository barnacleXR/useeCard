import { ref, computed, watch } from 'vue';
import { defineStore } from 'pinia';
import { japanMonth, type Account, type Card, type Bill, type FundingSummary, type Review, type Currency } from '@ccm/shared';
import { api } from '../api';
export const useWorkspace = defineStore('workspace', () => {
  const month = ref(japanMonth()); const reviewMonth = ref(japanMonth()); const currency = ref('');
  const accounts = ref<Account[]>([]); const cards = ref<Card[]>([]); const bills = ref<Bill[]>([]);
  const summary = ref<FundingSummary>({dueMonth: month.value, accounts: [], historicalPending: []});
  const report = ref<{byCurrency: {currency: Currency; pendingMinor: number; paidMinor: number; totalMinor: number; billCount: number}[]}>({byCurrency: []});
  const reviews = ref<Review[]>([]); const error = ref(''); const busy = ref(false); const defaultCurrency = ref<Currency>('JPY');
  // 每次成功刷新递增；自行取数的页面（如账单分页）据此重新加载。
  const revision = ref(0); const themePanel = ref(false);
  let sequence = 0;
  async function refresh() {
    const ticket = ++sequence; busy.value = true; error.value = '';
    const query = `dueMonth=${month.value}${currency.value ? `&currency=${currency.value}` : ''}`;
    try {
      const data = await Promise.all([api<Account[]>('/accounts'), api<Card[]>('/cards'), api<Bill[]>(`/bills?${query}`), api<FundingSummary>(`/summary?${query}`), api<typeof report.value>(`/reports/monthly?${query}`), api<Review[]>(`/reviews?reviewMonth=${reviewMonth.value}`), api<{defaultCurrency: Currency}>('/settings')]);
      if (ticket !== sequence) return;
      [accounts.value, cards.value, bills.value, summary.value, report.value, reviews.value] = data;
      defaultCurrency.value = data[6].defaultCurrency; revision.value++;
    } catch (e) { if (ticket === sequence) error.value = (e as Error).message; }
    finally { if (ticket === sequence) busy.value = false; }
  }
  async function mutate(path: string, body?: unknown, method = 'POST', key?: string) {
    error.value = '';
    try { const result = await api(path, method, body, key); await refresh(); return result; }
    catch (e) { error.value = (e as Error).message; throw e; }
  }
  // 列表按 id 取账户/卡片的名称与图标。
  const accountById = computed(() => new Map(accounts.value.map(a => [a.id, a])));
  const cardById = computed(() => new Map(cards.value.map(c => [c.id, c])));
  watch([month, currency, reviewMonth], () => { void refresh(); });
  return {month, reviewMonth, currency, accounts, cards, bills, summary, report, reviews, error, busy, defaultCurrency, revision, themePanel, accountById, cardById, refresh, mutate};
});
