<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { billSearchInput, currencies, japanMonth, type BillPage, type BillSearch } from '@ccm/shared';
import { SSelect, SIcon } from '@vean/ui';
import { api } from '../api';
import { useWorkspace } from '../stores/workspace';
import PageShell from '../components/PageShell.vue';
import BillList from '../components/BillList.vue';
import DateRangeInput from '../components/fields/DateRangeInput.vue';

const ALL = '__all__';
const store = useWorkspace();
const cardItems = computed(() => [
  { value: ALL, label: '全部卡片' },
  ...store.cards.map(item => ({ value: item.id, label: `${item.name}${item.archivedAt ? '（已归档）' : ''}` })),
]);
const accountItems = computed(() => [
  { value: ALL, label: '全部账户' },
  ...store.accounts.map(item => ({ value: item.id, label: `${item.name}${item.archivedAt ? '（已归档）' : ''}` })),
]);
const currencyItems = [
  { value: ALL, label: '全部币种' },
  ...Object.keys(currencies).map(value => ({ value, label: value })),
];
const statusItems = [
  { value: ALL, label: '全部状态' },
  { value: 'pending', label: '待确认扣款' },
  { value: 'paid', label: '已扣款' },
  { value: 'void', label: '已作废' },
];

// 默认显示当前日本月份；清空日期即查询全部历史。
const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return {
    from: `${month}-01`,
    to: `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`,
  };
};
const blank = () => ({ ...monthRange(japanMonth()), cardId: '', accountId: '', currency: '', status: '' });
const route = useRoute();

function linkedFilters() {
  const parsed = billSearchInput.safeParse(route.query);
  if (!parsed.success || !Object.keys(route.query).length) return blank();
  const q = parsed.data;
  return {
    from: q.from || '',
    to: q.to || '',
    cardId: q.cardId || '',
    accountId: q.accountId || '',
    currency: q.currency || '',
    status: q.status || '',
  };
}

const filters = ref(linkedFilters());
const page = ref(1);
const pageSize = 20;
const result = ref<BillPage>({ items: [], total: 0, page: 1, pageSize });
const loading = ref(false);
const error = ref('');
const pages = computed(() => Math.max(1, Math.ceil(result.value.total / pageSize)));
let sequence = 0;

async function load() {
  const ticket = ++sequence;
  loading.value = true;
  error.value = '';
  const query: BillSearch = { ...filters.value, page: page.value, pageSize };
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => [k, String(v)]),
  );
  try {
    const data = await api<BillPage>(`/bills/search?${params}`);
    if (ticket === sequence) result.value = data;
  } catch (e) {
    if (ticket === sequence) error.value = (e as Error).message;
  } finally {
    if (ticket === sequence) loading.value = false;
  }
}

watch(
  filters,
  () => {
    if (page.value === 1) void load();
    else page.value = 1;
  },
  { deep: true },
);
watch(page, () => void load());
watch(() => store.revision, () => void load());
watch(() => route.query, () => {
  filters.value = linkedFilters();
});
onMounted(load);
</script>

<template>
  <PageShell>
    <template #actions>
      <RouterLink to="/bills/reconcile" class="quiet">
        <SIcon icon="lucide:file-check-2" />
        <span>扣款核验</span>
      </RouterLink>
    </template>
    <section class="filter-bar">
      <div class="toolbar">
        <div class="field date-range-field">
          <span>扣款日</span>
          <DateRangeInput v-model:from="filters.from" v-model:to="filters.to" label="扣款日范围" />
        </div>
        <div class="field filter-select">
          <span>信用卡</span>
          <SSelect
            :model-value="filters.cardId || ALL"
            :items="cardItems"
            :trigger-props="{ 'aria-label': '信用卡' }"
            @update:model-value="v => (filters.cardId = v === ALL ? '' : String(v))"
          />
        </div>
        <div class="field filter-select">
          <span>扣款账户</span>
          <SSelect
            :model-value="filters.accountId || ALL"
            :items="accountItems"
            :trigger-props="{ 'aria-label': '扣款账户' }"
            @update:model-value="v => (filters.accountId = v === ALL ? '' : String(v))"
          />
        </div>
        <div class="field filter-select">
          <span>币种</span>
          <SSelect
            :model-value="filters.currency || ALL"
            :items="currencyItems"
            :trigger-props="{ 'aria-label': '币种' }"
            @update:model-value="v => (filters.currency = v === ALL ? '' : String(v))"
          />
        </div>
        <div class="field filter-select">
          <span>状态</span>
          <SSelect
            :model-value="filters.status || ALL"
            :items="statusItems"
            :trigger-props="{ 'aria-label': '状态' }"
            @update:model-value="v => (filters.status = v === ALL ? '' : String(v))"
          />
        </div>
        <button class="quiet" type="button" @click="filters = blank()">重置</button>
      </div>
    </section>

    <section class="tile-section">
      <p v-if="error" class="error" role="alert" style="margin-bottom: 12px">{{ error }}</p>
      <div v-else-if="loading && !result.items.length" class="panel empty">正在读取账单…</div>
      <template v-else>
        <BillList :bills="result.items" />
        <nav v-if="result.total" class="pager" aria-label="账单分页">
          <span class="muted">共 {{ result.total }} 笔 · 第 {{ page }} / {{ pages }} 页</span>
          <div class="master-actions">
            <button class="quiet sm" :disabled="page <= 1 || loading" @click="page--">上一页</button>
            <button class="quiet sm" :disabled="page >= pages || loading" @click="page++">下一页</button>
          </div>
        </nav>
      </template>
    </section>
  </PageShell>
</template>
